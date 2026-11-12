import { useCallback, useMemo } from "react";
import { messageKey, type MessageHeader } from "@mail-app/api-client";
import { useConfirm, useNotify } from "@/src/components/kit";
import { useApi } from "./connection";
import { useMail } from "./mail";

/** Actions on several messages at once (swipes, bulk selection). Lists update right away. */
export function useMessageActions() {
  const api = useApi();
  const notify = useNotify();
  const confirm = useConfirm();
  const { folders, updateMessage, removeMessage } = useMail();

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
      return removeEach(
        messages,
        (m) => api.remove(m.accountId, m.folder, m.uid),
        inTrash ? "Deleted" : messages.length > 1 ? `${messages.length} messages moved to Trash` : "Moved to Trash",
        "Couldn't delete",
      );
    },
    [api, confirm, removeEach, roleOf],
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

  return useMemo(() => ({ setSeen, setLabel, remove, archive, roleOf }), [setSeen, setLabel, remove, archive, roleOf]);
}
