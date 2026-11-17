import { useCallback, useMemo } from "react";
import { messageKey, type MessageHeader } from "@mail-app/api-client";
import { useConfirm, useNotify } from "@/src/components/kit";
import { blocksFor, type SpamBlock } from "@/src/components/SpamPanel";
import { useApi } from "./connection";
import { useMail } from "./mail";

/** Actions on several messages at once (swipes, bulk selection). Lists update right away. */
export function useMessageActions() {
  const api = useApi();
  const notify = useNotify();
  const confirm = useConfirm();
  const { folders, updateMessage, removeMessage, refresh } = useMail();

  const roleOf = useCallback(
    (m: MessageHeader) => folders[m.accountId]?.find((f) => f.path === m.folder)?.role ?? null,
    [folders],
  );

  /** Read or unread. Shows the change first, puts it back if the server refuses. */
  const setSeen = useCallback(
    (messages: MessageHeader[], seen: boolean) => {
      for (const m of messages.filter((m) => m.seen !== seen)) {
        const key = messageKey(m);
        updateMessage(key, { seen });
        api.setFlags(m.accountId, m.folder, m.uid, { seen }).catch((e: Error) => {
          updateMessage(key, { seen: !seen });
          notify(`Couldn't mark as ${seen ? "read" : "unread"}`, e.message, "error");
        });
      }
    },
    [api, notify, updateMessage],
  );

  /** Adds (`on`) or removes a label. */
  const setLabel = useCallback(
    (messages: MessageHeader[], labelId: string, on: boolean) => {
      for (const m of messages) {
        const current = m.labels ?? [];
        if (current.includes(labelId) === on) continue;
        const key = messageKey(m);
        updateMessage(key, { labels: on ? [...current, labelId] : current.filter((l) => l !== labelId) });
        api.setFlags(m.accountId, m.folder, m.uid, { labels: { [labelId]: on } }).catch((e: Error) => {
          updateMessage(key, { labels: current });
          notify("Couldn't change the label", e.message, "error");
        });
      }
    },
    [api, notify, updateMessage],
  );

  /** Runs `action` on each message and drops the ones it succeeded for from the list. */
  const removeEach = useCallback(
    async (messages: MessageHeader[], action: (m: MessageHeader) => Promise<unknown>, done: string, failed: string) => {
      const results = await Promise.allSettled(messages.map(action));
      results.forEach((r, i) => r.status === "fulfilled" && removeMessage(messageKey(messages[i]!)));
      const error = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (error) notify(failed, (error.reason as Error).message, "error");
      else notify(done);
      return results.some((r) => r.status === "fulfilled");
    },
    [notify, removeMessage],
  );

  /**
   * After messages were moved (to Trash or a folder): a notice with Undo, which
   * moves each back where it was (by its new id there) and reloads the list.
   */
  const offerUndo = useCallback(
    (text: string, moved: { message: Pick<MessageHeader, "accountId" | "folder">; to: string; uid?: number }[], undoAlso?: () => Promise<unknown>) => {
      const undoable = moved.filter((m) => m.uid !== undefined);
      if (!undoable.length) return notify(text);
      notify(text, undefined, "info", {
        duration: 8000,
        action: {
          label: "Undo",
          onPress: () => {
            void Promise.allSettled([...undoable.map((m) => api.move(m.message.accountId, m.to, m.uid!, m.message.folder)), ...(undoAlso ? [undoAlso()] : [])]).then((results) => {
              const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
              if (failed) notify("Couldn't undo", (failed.reason as Error).message, "error");
              else notify(undoable.length > 1 ? `${undoable.length} messages put back` : "Put back");
              void refresh();
            });
          },
        },
      });
    },
    [api, notify, refresh],
  );

  /** Moves messages to a folder (path), with Undo. Resolves whether any moved. */
  const moveTo = useCallback(
    async (messages: MessageHeader[], path: string, folderName: string): Promise<boolean> => {
      const results = await Promise.allSettled(messages.map((m) => api.move(m.accountId, m.folder, m.uid, path)));
      const moved: { message: MessageHeader; to: string; uid?: number }[] = [];
      results.forEach((r, i) => {
        if (r.status !== "fulfilled") return;
        removeMessage(messageKey(messages[i]!));
        moved.push({ message: messages[i]!, to: r.value.destination, uid: r.value.uid });
      });
      const error = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (error) notify("Couldn't move", (error.reason as Error).message, "error");
      else offerUndo(moved.length > 1 ? `${moved.length} messages moved to ${folderName}` : `Moved to ${folderName}`, moved);
      return moved.length > 0;
    },
    [api, notify, offerUndo, removeMessage],
  );

  /**
   * Report spam: to each account's spam folder, blocking per `choice`. Undo
   * moves them back and removes the block rules this added.
   */
  const reportSpam = useCallback(
    async (messages: MessageHeader[], choice: SpamBlock): Promise<boolean> => {
      if (!messages.length) return false;
      const started = Date.now();
      const blocks = blocksFor(choice, messages);
      // Each block once: with the first message of its sender (or the first message, for a domain list or regex).
      const blockFor = (m: MessageHeader, i: number) =>
        choice.kind === "sender" ? blocks.find((b) => b.value === m.from.address.trim().toLowerCase() && messages.findIndex((x) => x.from.address.trim().toLowerCase() === b.value) === i) : undefined;
      const results = await Promise.allSettled(messages.map((m, i) => api.reportSpam(m.accountId, m.folder, m.uid, blockFor(m, i))));
      // Domain and regex rules: added once, apart.
      const extra = choice.kind === "domain" || choice.kind === "regex" ? await Promise.allSettled(blocks.map((b) => api.addBlock(b))) : [];
      const added = [
        ...results.flatMap((r) => (r.status === "fulfilled" && r.value.rule ? [r.value.rule] : [])),
        ...extra.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
      ].filter((rule) => Date.parse(rule.createdAt) >= started - 5000); // new ones only: Undo leaves older rules alone
      const moved: { message: MessageHeader; to: string; uid?: number }[] = [];
      results.forEach((r, i) => {
        if (r.status !== "fulfilled") return;
        removeMessage(messageKey(messages[i]!));
        moved.push({ message: messages[i]!, to: r.value.destination, uid: r.value.uid });
      });
      const error = [...results, ...extra].find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (error) notify("Couldn't report spam", (error.reason as Error).message, "error");
      else {
        const blocked = choice.kind === "none" ? "" : added.length ? ` · ${added.length === 1 ? "sender blocked" : `${added.length} rules added`}` : "";
        offerUndo(`${moved.length > 1 ? `${moved.length} messages moved` : "Moved"} to spam${blocked}`, moved, () => Promise.all(added.map((rule) => api.removeBlock(rule.id))));
      }
      return moved.length > 0;
    },
    [api, notify, offerUndo, removeMessage],
  );

  /** To Trash, or deleted for good (after asking) when already in Trash. Resolves whether anything went. */
  const remove = useCallback(
    async (messages: MessageHeader[]): Promise<boolean> => {
      if (!messages.length) return false;
      const inTrash = messages.some((m) => roleOf(m) === "trash");
      if (inTrash) {
        const ok = await confirm({
          title: "Delete forever?",
          message: messages.length > 1 ? `These ${messages.length} messages will be permanently deleted.` : "This message will be permanently deleted.",
          confirmLabel: "Delete",
          destructive: true,
        });
        if (!ok) return false;
      }
      if (inTrash) return removeEach(messages, (m) => api.remove(m.accountId, m.folder, m.uid), "Deleted", "Couldn't delete");
      const results = await Promise.allSettled(messages.map((m) => api.remove(m.accountId, m.folder, m.uid)));
      const moved: { message: MessageHeader; to: string; uid?: number }[] = [];
      results.forEach((r, i) => {
        if (r.status !== "fulfilled") return;
        removeMessage(messageKey(messages[i]!));
        if (r.value.trash) moved.push({ message: messages[i]!, to: r.value.trash.folder, uid: r.value.trash.uid });
      });
      const error = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (error) notify("Couldn't delete", (error.reason as Error).message, "error");
      else offerUndo(moved.length > 1 ? `${moved.length} messages moved to Trash` : "Moved to Trash", moved);
      return results.some((r) => r.status === "fulfilled");
    },
    [api, confirm, notify, offerUndo, removeEach, removeMessage, roleOf],
  );

  const archive = useCallback(
    (messages: MessageHeader[]) =>
      removeEach(
        messages,
        (m) => api.move(m.accountId, m.folder, m.uid, "archive"),
        messages.length > 1 ? `${messages.length} messages archived` : "Archived",
        "Couldn't archive",
      ),
    [api, removeEach],
  );

  return useMemo(
    () => ({ setSeen, setLabel, remove, archive, moveTo, reportSpam, offerUndo, roleOf }),
    [setSeen, setLabel, remove, archive, moveTo, reportSpam, offerUndo, roleOf],
  );
}
