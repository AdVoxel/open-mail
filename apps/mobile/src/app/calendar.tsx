import { useCallback, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { ArrowLeft, Bell, CalendarDays, ChevronLeft, ChevronRight, MapPin, Plus, RefreshCw, Repeat, UserCog } from "lucide-react-native";
import type { CalendarEvent, CalendarInfo } from "@mail-app/api-client";
import { Button, ButtonText } from "@/components/ui/button";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { AccountCalendarSettings } from "@/src/components/CalendarSetup";
import { ColorDot, EmptyState, ErrorBanner, Header, IconButton, Loading } from "@/src/components/kit";
import { addDays, dayStart, eventDays, eventKey, formatEventTime, monthGrid, openedEvents, ymd } from "@/src/lib/calendarDates";
import { useApi } from "@/src/lib/connection";
import { useIsWide } from "@/src/lib/format";
import { useMail } from "@/src/lib/mail";
import { useColors } from "@/src/lib/theme";

const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "short" }));

function openEvent(event: CalendarEvent) {
  const key = eventKey(event);
  openedEvents.set(key, event);
  router.push({ pathname: "/event", params: { key } });
}

function EventRow({ event, color }: { event: CalendarEvent; color: string }) {
  const colors = useColors();
  return (
    <Pressable onPress={() => openEvent(event)} className="flex-row gap-3 rounded-lg px-2 py-2 data-[hover=true]:bg-accent/60">
      <View style={{ backgroundColor: color }} className="w-1 rounded-full" />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text size="sm" numberOfLines={2} className="font-medium">
          {event.title}
        </Text>
        <View className="flex-row items-center gap-1.5">
          <Text size="xs" className="text-muted-foreground">
            {formatEventTime(event)}
          </Text>
          {event.recurring ? <Repeat size={11} color={colors.muted} /> : null}
          {event.alerts?.length ? <Bell size={11} color={colors.muted} /> : null}
          {event.invitation?.status === "needs-action" ? (
            <Text size="xs" className="font-medium" style={{ color: colors.accent }}>
              Invitation: answer
            </Text>
          ) : null}
        </View>
        {event.location ? (
          <View className="flex-row items-center gap-1">
            <MapPin size={11} color={colors.muted} />
            <Text size="xs" numberOfLines={1} className="flex-1 text-muted-foreground">
              {event.location}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function CalendarScreen() {
  const api = useApi();
  const isWide = useIsWide();
  const colors = useColors();
  const { accounts } = useMail();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(() => ymd(new Date()));
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [errors, setErrors] = useState<{ accountId: string; error: string }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const grid = useMemo(() => monthGrid(month), [month]);
  const today = ymd(new Date());
  const enabled = accounts.filter((a) => a.calendar.enabled);
  // Accounts whose calendars the app can reach (Gmail, iCloud), for the sign-in panel.
  const calendarAccounts = accounts.filter((a) => a.calendar.provider);
  const [setupOpen, setSetupOpen] = useState(false);
  // Reload when an account is turned on, connected, or a calendar hidden.
  const accountsKey = calendarAccounts.map((a) => `${a.id}:${a.calendar.enabled}:${a.calendar.hidden.join(",")}`).join("|");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [calendarPage, eventPage] = await Promise.all([
        api.calendars(),
        api.events(dayStart(grid[0]!), dayStart(addDays(grid[grid.length - 1]!, 1))),
      ]);
      setCalendars(calendarPage.calendars);
      setEvents(eventPage.events);
      const byAccount = new Map([...calendarPage.errors, ...eventPage.errors].map((e) => [e.accountId, e]));
      setErrors([...byAccount.values()]);
      setLoadError(null);
    } catch (e) {
      // Older servers have no calendar API: say so instead of showing an empty month.
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, grid, accountsKey]);

  // Also after coming back from the event editor.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const colorOf = useCallback(
    (e: CalendarEvent) => calendars.find((c) => c.accountId === e.accountId && c.id === e.calendarId)?.color ?? colors.accent,
    [calendars, colors.accent],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) for (const day of eventDays(e)) map.set(day, [...(map.get(day) ?? []), e]);
    return map;
  }, [events]);
  const labels = Object.fromEntries(accounts.map((a) => [a.id, a.label]));

  const shiftMonth = (by: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + by, 1));
  const goToday = () => {
    const now = new Date();
    setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelected(ymd(now));
  };
  const newEvent = () => router.push({ pathname: "/event", params: { date: selected } });

  const header = (
    <Header
      safeTop={!isWide}
      title={month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
      left={!isWide ? <IconButton icon={ArrowLeft} label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} /> : undefined}
      right={
        <>
          <IconButton icon={ChevronLeft} label="Previous month" onPress={() => shiftMonth(-1)} />
          <Button size="sm" variant="outline" className="rounded-lg" onPress={goToday}>
            <ButtonText>Today</ButtonText>
          </Button>
          <IconButton icon={ChevronRight} label="Next month" onPress={() => shiftMonth(1)} />
          <IconButton icon={RefreshCw} label="Refresh" onPress={() => void load()} disabled={loading} />
          {calendarAccounts.length ? (
            <IconButton icon={UserCog} label="Calendar accounts" active={setupOpen} onPress={() => setSetupOpen((o) => !o)} />
          ) : null}
          <IconButton icon={Plus} label="New event" onPress={newEvent} disabled={!calendars.some((c) => c.visible && !c.readOnly)} />
        </>
      }
    />
  );

  // Sign in / turn on each account's calendar right here (the same controls as in Settings).
  const setupPanel = (
    <View className="mx-auto w-full max-w-3xl gap-3 p-4">
      <View>
        <Text className="font-semibold">Connect your calendars</Text>
        <Text size="sm" className="text-muted-foreground">
          iCloud uses the account's app password; Gmail needs a Google sign-in.
        </Text>
      </View>
      {calendarAccounts.map((a) => (
        <View key={a.id} className="gap-2 rounded-xl border border-border p-3">
          <View className="flex-row items-center gap-2">
            <ColorDot color={a.color} size={10} />
            <Text size="sm" className="font-medium">
              {a.label}
            </Text>
            <Text size="xs" numberOfLines={1} className="flex-1 text-muted-foreground">
              {a.address}
            </Text>
          </View>
          <AccountCalendarSettings account={a} />
        </View>
      ))}
    </View>
  );

  if (!enabled.length && !loading) {
    return (
      <View className="flex-1 bg-background">
        {header}
        {calendarAccounts.length ? (
          <ScrollView>{setupPanel}</ScrollView>
        ) : (
          <EmptyState
            icon={CalendarDays}
            title="No calendars yet"
            message="Calendars work for Gmail and iCloud accounts. Add one in Settings."
            action={
              <Pressable onPress={() => router.navigate("/settings")} className="rounded-lg bg-primary px-4 py-2">
                <Text size="sm" className="font-medium text-primary-foreground">
                  Open Settings
                </Text>
              </Pressable>
            }
          />
        )}
      </View>
    );
  }

  const selectedEvents = byDay.get(selected) ?? [];
  const agenda = (
    <View className="gap-1">
      <Text className="px-2 pb-1 font-semibold">{dayStart(selected).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</Text>
      {selectedEvents.length ? (
        selectedEvents.map((e) => <EventRow key={eventKey(e)} event={e} color={colorOf(e)} />)
      ) : (
        <Text size="sm" className="px-2 text-muted-foreground">
          Nothing on this day.
        </Text>
      )}
    </View>
  );

  const cellHeight = isWide ? 104 : 52;
  const monthView = (
    <View>
      <View className="flex-row border-b border-border">
        {WEEKDAYS.map((d) => (
          <Text key={d} size="xs" className="flex-1 py-2 text-center font-medium uppercase text-muted-foreground">
            {d}
          </Text>
        ))}
      </View>
      {Array.from({ length: 6 }, (_, week) => (
        <View key={week} className="flex-row">
          {grid.slice(week * 7, week * 7 + 7).map((day) => {
            const inMonth = dayStart(day).getMonth() === month.getMonth();
            const dayEvents = byDay.get(day) ?? [];
            const isSelected = day === selected;
            return (
              <Pressable
                key={day}
                onPress={() => setSelected(day)}
                style={{ height: cellHeight }}
                className={`flex-1 gap-0.5 border-b border-r border-border/60 p-1 ${isSelected ? "bg-accent" : "data-[hover=true]:bg-accent/40"}`}
              >
                <View className="flex-row">
                  <View
                    style={day === today ? { backgroundColor: colors.accent } : undefined}
                    className="h-6 min-w-6 items-center justify-center rounded-full px-1"
                  >
                    <Text size="xs" style={day === today ? { color: "#ffffff" } : undefined} className={`font-medium ${inMonth ? "" : "text-muted-foreground/60"}`}>
                      {dayStart(day).getDate()}
                    </Text>
                  </View>
                </View>
                {isWide ? (
                  <>
                    {dayEvents.slice(0, 3).map((e) => (
                      <View key={eventKey(e)} style={{ backgroundColor: `${colorOf(e)}26`, borderLeftColor: colorOf(e) }} className="overflow-hidden rounded-sm border-l-2 px-1">
                        <Text size="2xs" numberOfLines={1} className="web:whitespace-nowrap">
                          {`${e.allDay ? "" : `${new Date(e.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} `}${e.title}`}
                        </Text>
                      </View>
                    ))}
                    {dayEvents.length > 3 ? (
                      <Text size="2xs" className="px-1 text-muted-foreground">
                        +{dayEvents.length - 3} more
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <View className="flex-row flex-wrap justify-center gap-0.5">
                    {dayEvents.slice(0, 4).map((e) => (
                      <View key={eventKey(e)} style={{ backgroundColor: colorOf(e) }} className="h-1.5 w-1.5 rounded-full" />
                    ))}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );

  const banners = (
    <>
      {setupOpen ? <View className="border-b border-border">{setupPanel}</View> : null}
      {loadError ? <ErrorBanner message={`Calendars: ${loadError}`} onRetry={() => void load()} /> : null}
      {errors.map((e) => (
        <ErrorBanner key={e.accountId} message={`${labels[e.accountId] ?? e.accountId}: ${e.error}`} />
      ))}
    </>
  );

  return (
    <View className="flex-1 bg-background">
      {header}
      {loading && !events.length && !loadError ? (
        <Loading />
      ) : isWide ? (
        <View className="flex-1 flex-row">
          {/* Sized Views around the ScrollViews: a ScrollView doesn't reliably take flex/width itself. */}
          <View className="min-w-0 flex-1">
            <ScrollView contentContainerClassName="pb-8">
              {banners}
              {monthView}
            </ScrollView>
          </View>
          <View style={{ width: 300 }} className="border-l border-border">
            <ScrollView contentContainerClassName="p-3">{agenda}</ScrollView>
          </View>
        </View>
      ) : (
        <ScrollView contentContainerClassName="gap-4 pb-16">
          {banners}
          {monthView}
          <View className="px-2">{agenda}</View>
        </ScrollView>
      )}
    </View>
  );
}
