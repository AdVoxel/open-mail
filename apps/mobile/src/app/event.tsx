import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Trash2, X } from "lucide-react-native";
import type { CalendarInfo, EventGuest, EventInput, InvitationResponse, InvitationStatus } from "@mail-app/api-client";
import { Button, ButtonText } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { DateField, TimeField } from "@/src/components/DateTimeFields";
import { RecipientInput } from "@/src/components/RecipientInput";
import { ColorDot, EmptyState, ErrorBanner, Header, IconButton, Loading, useConfirm, useNotify } from "@/src/components/kit";
import { addDays, hm, localDateTime, openedEvents, ymd } from "@/src/lib/calendarDates";
import { useApi } from "@/src/lib/connection";
import { recipientEmail, splitRecipients } from "@/src/lib/contacts";
import { useMail } from "@/src/lib/mail";
import { useColors } from "@/src/lib/theme";

function close() {
  if (router.canGoBack()) router.back();
  else router.replace("/calendar");
}

/** `layer`: draws above the fields after it (for suggestion lists; web stacks every view on its own). */
function Field({ label, children, layer }: { label: string; children: React.ReactNode; layer?: number }) {
  return (
    <View className="gap-1.5" style={layer ? { zIndex: layer } : undefined}>
      <Text size="sm" className="font-medium">
        {label}
      </Text>
      {children}
    </View>
  );
}

/** An alert in words: "15 min before", "1 day before at 09:00" (all-day events count from midnight). */
function alertText(minutes: number, allDay: boolean): string {
  if (minutes === 0) return allDay ? "On the day at 00:00" : "At the start";
  if (allDay) {
    const days = Math.ceil(minutes / 1440);
    const at = days * 1440 - minutes; // minutes after midnight on that day
    const time = `${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`;
    if (minutes < 0) return `On the day at ${`${String(Math.floor(-minutes / 60)).padStart(2, "0")}:${String(-minutes % 60).padStart(2, "0")}`}`;
    return `${days === 1 ? "1 day" : `${days} days`} before at ${time}`;
  }
  if (minutes < 0) return `${-minutes} min after the start`;
  if (minutes < 60) return `${minutes} min before`;
  if (minutes % 1440 === 0) return minutes === 1440 ? "1 day before" : `${minutes / 1440} days before`;
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour before" : `${minutes / 60} hours before`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min before`;
}

const ANSWERS: { response: InvitationResponse; label: string }[] = [
  { response: "accepted", label: "Accept" },
  { response: "tentative", label: "Maybe" },
  { response: "declined", label: "Decline" },
];

const STATUS_TEXT: Record<InvitationStatus, string> = {
  "needs-action": "You haven't answered yet.",
  accepted: "You accepted.",
  tentative: "You answered maybe.",
  declined: "You declined.",
};

/** Why an event can't be changed here. */
function readOnlyReason(event: { recurring: boolean; hasAttendees: boolean; invitation?: unknown }, calendarReadOnly: boolean): string {
  if (event.invitation) return "You're a guest: the organizer changes the event. You can answer the invitation below.";
  if (calendarReadOnly) return "This calendar is read-only.";
  if (event.recurring) return "Repeating events can't be changed from the app yet. Edit them in Google Calendar or iCloud.";
  if (event.hasAttendees) return "Only the organizer can change an event with guests.";
  return "This event can't be changed from the app.";
}

const GUEST_STATUS: Record<InvitationStatus, string> = {
  "needs-action": "invited",
  accepted: "going",
  tentative: "maybe",
  declined: "not going",
};

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Guests as chips, and a field that suggests contacts; typing a comma (or picking one) adds the address. */
function GuestsField({
  guests,
  onChange,
  known,
  draft,
  onDraft,
  disabled,
  inputClass,
}: {
  guests: string[];
  onChange: (guests: string[]) => void;
  known: EventGuest[];
  draft: string;
  onDraft: (draft: string) => void;
  disabled: boolean;
  inputClass: string;
}) {
  const colors = useColors();
  const take = (value: string) => {
    const parts = splitRecipients(value);
    const done = parts.slice(0, -1).map(recipientEmail).filter((e) => EMAIL.test(e));
    const fresh = done.filter((e) => !guests.some((g) => g.toLowerCase() === e.toLowerCase()));
    if (fresh.length) onChange([...guests, ...fresh]);
    onDraft(parts.length > 1 ? parts.at(-1)!.trimStart() : value);
  };
  return (
    <View className="gap-2">
      {guests.length ? (
        <View className="flex-row flex-wrap gap-1.5">
          {guests.map((email) => {
            const info = known.find((k) => k.email.toLowerCase() === email.toLowerCase());
            return (
              <View key={email} className="flex-row items-center gap-1 rounded-full border border-border py-1 pl-3 pr-1">
                <Text size="sm">{info?.name || email}</Text>
                {info ? (
                  <Text size="xs" className="text-muted-foreground">
                    · {GUEST_STATUS[info.status]}
                  </Text>
                ) : null}
                {!disabled ? (
                  <Pressable
                    onPress={() => onChange(guests.filter((g) => g !== email))}
                    accessibilityLabel={`Remove ${email}`}
                    className="h-6 w-6 items-center justify-center rounded-full data-[hover=true]:bg-accent"
                  >
                    <X size={12} color={colors.muted} />
                  </Pressable>
                ) : (
                  <View className="w-2" />
                )}
              </View>
            );
          })}
        </View>
      ) : null}
      {!disabled ? <RecipientInput value={draft} onChangeText={take} placeholder="Start typing a name or email" className={inputClass} /> : null}
    </View>
  );
}

/** New event (`date` param) or an existing one (`key` param, from the calendar screen). */
export default function EventScreen() {
  const { key, date } = useLocalSearchParams<{ key?: string; date?: string }>();
  const existing = key ? openedEvents.get(key) : undefined;
  const api = useApi();
  const notify = useNotify();
  const confirm = useConfirm();
  const colors = useColors();
  const { accounts } = useMail();

  const [calendars, setCalendars] = useState<CalendarInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState<{ accountId: string; calendarId: string } | null>(
    existing ? { accountId: existing.accountId, calendarId: existing.calendarId } : null,
  );

  // Form values in local time; all-day end dates are shown inclusive.
  const initial = useMemo(() => {
    if (existing) {
      const start = new Date(existing.start);
      const end = new Date(existing.end);
      return existing.allDay
        ? { allDay: true, startDay: existing.start, startTime: "09:00", endDay: addDays(existing.end, -1), endTime: "10:00" }
        : { allDay: false, startDay: ymd(start), startTime: hm(start), endDay: ymd(end), endTime: hm(end) };
    }
    const next = new Date();
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    const day = date || ymd(next);
    const startTime = hm(next);
    const later = new Date(next.getTime() + 60 * 60_000);
    return { allDay: false, startDay: day, startTime, endDay: day, endTime: hm(later) };
  }, [existing, date]);

  const [title, setTitle] = useState(existing?.title ?? "");
  const [allDay, setAllDay] = useState(initial.allDay);
  const [startDay, setStartDay] = useState(initial.startDay);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endDay, setEndDay] = useState(initial.endDay);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [location, setLocation] = useState(existing?.location ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [guests, setGuests] = useState<string[]>(existing?.guests?.map((g) => g.email) ?? []);
  const [guestDraft, setGuestDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<InvitationStatus | undefined>(existing?.invitation?.status);

  const respond = async (response: InvitationResponse) => {
    if (!existing || !target) return;
    setBusy(true);
    try {
      await api.respondToEvent({ ...target, eventId: existing.id }, response);
      setAnswer(response);
      if (key) openedEvents.set(key, { ...existing, invitation: { organizer: existing.invitation!.organizer, status: response } });
      notify("Answer sent", existing.invitation ? `${existing.invitation.organizer} will be told.` : undefined);
    } catch (e) {
      notify("Couldn't answer", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    api.calendars().then(
      (page) => {
        if (cancelled) return;
        setCalendars(page.calendars);
        if (!existing) {
          const first = page.calendars.find((c) => c.visible && !c.readOnly);
          setTarget((t) => t ?? (first ? { accountId: first.accountId, calendarId: first.id } : null));
        }
      },
      (e: Error) => !cancelled && setLoadError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [api, existing]);

  const calendar = calendars?.find((c) => c.accountId === target?.accountId && c.id === target?.calendarId);
  const editable = existing ? existing.editable && !calendar?.readOnly : true;
  const writable = (calendars ?? []).filter((c) => c.visible && !c.readOnly);
  const labels = Object.fromEntries(accounts.map((a) => [a.id, a.label]));

  // Keep the end after the start when the start moves.
  const changeStartDay = (day: string) => {
    if (endDay < day || endDay === startDay) setEndDay(day);
    setStartDay(day);
  };

  /** The guest list to save: the chips, plus an address still being typed. Older servers (no guests on events) get none. */
  const guestList = (): string[] | string | undefined => {
    if (existing && !existing.guests) return undefined;
    const typed = recipientEmail(guestDraft);
    if (!typed) return guests;
    if (!EMAIL.test(typed)) return `"${typed}" isn't an email address`;
    return guests.some((g) => g.toLowerCase() === typed.toLowerCase()) ? guests : [...guests, typed];
  };

  const input = (): EventInput | string => {
    const list = guestList();
    if (typeof list === "string") return list;
    if (allDay) {
      if (endDay < startDay) return "The end date is before the start date";
      return { title, allDay, start: startDay, end: addDays(endDay, 1), location, description, guests: list };
    }
    if (!/^\d{1,2}:\d{2}$/.test(startTime) || !/^\d{1,2}:\d{2}$/.test(endTime)) return "Times look like 09:30";
    const start = localDateTime(startDay, startTime);
    const end = localDateTime(endDay, endTime);
    if (end < start) return "The event ends before it starts";
    return { title, allDay, start, end, location, description, guests: list };
  };

  const save = async () => {
    const values = input();
    if (typeof values === "string") return notify(values, undefined, "error");
    if (!target) return notify("Pick a calendar", undefined, "error");
    setBusy(true);
    try {
      if (existing) await api.updateEvent({ ...target, eventId: existing.id }, values);
      else await api.createEvent(target, values);
      const before = new Set((existing?.guests ?? []).map((g) => g.email.toLowerCase()));
      const invited = (values.guests ?? []).filter((g) => !before.has(g.toLowerCase())).length;
      notify(
        existing ? "Event updated" : "Event added",
        invited ? `Invitation sent to ${invited} ${invited === 1 ? "guest" : "guests"}.` : values.guests?.length ? "Guests are told about the change." : undefined,
      );
      close();
    } catch (e) {
      notify("Couldn't save the event", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing || !target) return;
    if (!(await confirm({ title: "Delete this event?", message: existing.title, confirmLabel: "Delete", destructive: true }))) return;
    setBusy(true);
    try {
      await api.deleteEvent({ ...target, eventId: existing.id });
      notify("Event deleted");
      close();
    } catch (e) {
      notify("Couldn't delete the event", (e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <Header
      safeTop
      title={existing ? (editable ? "Edit event" : "Event") : "New event"}
      left={<IconButton icon={X} label="Close" onPress={close} />}
      right={
        <>
          {existing && editable ? <IconButton icon={Trash2} label="Delete event" onPress={() => void remove()} disabled={busy} /> : null}
          {editable ? (
            <Button size="sm" className="ml-1 rounded-lg" disabled={busy || !target} onPress={() => void save()}>
              <ButtonText>{busy ? "Saving…" : "Save"}</ButtonText>
            </Button>
          ) : null}
        </>
      }
    />
  );

  if (key && !existing) {
    return (
      <View className="flex-1 bg-background">
        {header}
        <EmptyState icon={X} title="Event not found" message="Open it again from the calendar." />
      </View>
    );
  }
  if (!calendars && !loadError) {
    return (
      <View className="flex-1 bg-background">
        {header}
        <Loading />
      </View>
    );
  }

  const inputClass = "h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground font-sans web:outline-none";
  const disabled = !editable || busy;

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {header}
      <ScrollView contentContainerClassName="mx-auto w-full max-w-2xl gap-4 px-4 pb-16 pt-4" keyboardShouldPersistTaps="handled">
        {loadError ? <ErrorBanner message={loadError} /> : null}
        {!editable && existing ? (
          <View className="rounded-lg border border-border bg-muted/40 p-3">
            <Text size="sm" className="text-muted-foreground">
              {readOnlyReason(existing, Boolean(calendar?.readOnly))}
            </Text>
          </View>
        ) : null}

        {existing?.invitation ? (
          <View className="gap-2 rounded-xl border border-border p-3">
            <Text size="sm">
              <Text size="sm" className="font-semibold">
                Invitation
              </Text>{" "}
              from {existing.invitation.organizer}. {STATUS_TEXT[answer ?? "needs-action"]}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {ANSWERS.map((a) => (
                <Button
                  key={a.response}
                  size="sm"
                  variant={answer === a.response ? "default" : "outline"}
                  className="rounded-lg"
                  disabled={busy}
                  onPress={() => void respond(a.response)}
                >
                  <ButtonText>{a.label}</ButtonText>
                </Button>
              ))}
            </View>
            {existing.recurring && existing.id.includes("#") ? (
              <Text size="xs" className="text-muted-foreground">
                For a repeating iCloud event, the answer applies to the whole series.
              </Text>
            ) : null}
          </View>
        ) : null}

        <TextInput
          value={title}
          onChangeText={setTitle}
          editable={!disabled}
          autoFocus={!existing}
          placeholder="Title"
          placeholderTextColor={colors.muted}
          className="h-12 border-b border-border text-xl font-semibold text-foreground font-sans web:outline-none"
        />

        <Field label="Calendar">
          {existing ? (
            <View className="flex-row items-center gap-2">
              <ColorDot color={calendar?.color ?? colors.accent} size={10} />
              <Text size="sm">
                {calendar?.name ?? "Calendar"} · {labels[existing.accountId] ?? existing.accountId}
              </Text>
            </View>
          ) : writable.length ? (
            <View className="flex-row flex-wrap gap-1.5">
              {writable.map((c) => {
                const on = c.accountId === target?.accountId && c.id === target?.calendarId;
                return (
                  <Pressable
                    key={`${c.accountId}:${c.id}`}
                    onPress={() => setTarget({ accountId: c.accountId, calendarId: c.id })}
                    className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1 ${on ? "border-primary bg-primary" : "border-border data-[hover=true]:bg-accent"}`}
                  >
                    <ColorDot color={c.color} />
                    <Text size="sm" className={on ? "text-primary-foreground" : "text-foreground"}>
                      {c.name} · {labels[c.accountId] ?? c.accountId}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text size="sm" className="text-muted-foreground">
              No calendar you can add events to. Turn calendars on in Settings.
            </Text>
          )}
        </Field>

        <View className="flex-row items-center gap-3">
          <Text size="sm" className="flex-1 font-medium">
            All day
          </Text>
          <Switch size="sm" value={allDay} disabled={disabled} onValueChange={setAllDay} />
        </View>

        <Field label="Starts">
          <View className="flex-row flex-wrap gap-2">
            <DateField value={startDay} onChange={changeStartDay} disabled={disabled} />
            {!allDay ? <TimeField value={startTime} onChange={setStartTime} disabled={disabled} /> : null}
          </View>
        </Field>
        <Field label="Ends">
          <View className="flex-row flex-wrap gap-2">
            <DateField value={endDay} onChange={setEndDay} disabled={disabled} />
            {!allDay ? <TimeField value={endTime} onChange={setEndTime} disabled={disabled} /> : null}
          </View>
        </Field>

        {existing?.alerts.length ? (
          <Field label="Alerts">
            <Text size="sm" className="text-muted-foreground">
              {existing.alerts.map((m) => alertText(m, existing.allDay)).join(" · ")}
            </Text>
          </Field>
        ) : null}

        {editable || guests.length ? (
          <Field label="Guests" layer={10}>
            <GuestsField
              guests={guests}
              onChange={setGuests}
              known={existing?.guests ?? []}
              draft={guestDraft}
              onDraft={setGuestDraft}
              disabled={disabled}
              inputClass={inputClass}
            />
          </Field>
        ) : null}

        <Field label="Location">
          <TextInput value={location} onChangeText={setLocation} editable={!disabled} placeholderTextColor={colors.muted} className={inputClass} />
        </Field>
        <Field label="Notes">
          <TextInput
            value={description}
            onChangeText={setDescription}
            editable={!disabled}
            multiline
            textAlignVertical="top"
            placeholderTextColor={colors.muted}
            className="min-h-[120px] rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground font-sans web:outline-none"
          />
        </Field>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
