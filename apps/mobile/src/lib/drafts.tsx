import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { OutgoingMail } from "@mail-app/api-client";
import type { PickedFile } from "@/src/components/pickFiles";

/** The route params a compose screen was opened with (reply to which message, which scheduled mail…). */
export interface ComposeParams {
  mode?: "new" | "reply" | "replyAll" | "forward" | "edit" | "draft";
  accountId?: string;
  folder?: string;
  uid?: string;
  scheduledId?: string;
}

/** Everything on a compose screen, kept while it's minimized to a bar. */
export interface MinimizedDraft {
  id: string;
  params: ComposeParams;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  showCc: boolean;
  subject: string;
  text: string;
  html: string | null;
  threading: Pick<OutgoingMail, "inReplyTo" | "references">;
  attachments: PickedFile[];
  sendAt?: Date;
  withSignature: boolean;
  /** The copy saved in the account's Drafts folder, if any. */
  serverDraft?: { accountId: string; folder: string; uid: number } | null;
}

interface DraftsState {
  drafts: MinimizedDraft[];
  /** Keeps the draft; resolves its id. */
  minimize: (draft: Omit<MinimizedDraft, "id"> & { id?: string }) => string;
  get: (id: string) => MinimizedDraft | undefined;
  remove: (id: string) => void;
}

const Context = createContext<DraftsState | null>(null);

/** Drafts minimized to bars at the bottom of the screen. In memory: a reload forgets them. */
export function DraftsProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<MinimizedDraft[]>([]);

  const minimize = useCallback((draft: Omit<MinimizedDraft, "id"> & { id?: string }) => {
    const id = draft.id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setDrafts((list) => [...list.filter((d) => d.id !== id), { ...draft, id }]);
    return id;
  }, []);
  const remove = useCallback((id: string) => setDrafts((list) => list.filter((d) => d.id !== id)), []);
  const get = useCallback((id: string) => drafts.find((d) => d.id === id), [drafts]);

  const value = useMemo(() => ({ drafts, minimize, get, remove }), [drafts, minimize, get, remove]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDrafts(): DraftsState {
  const value = useContext(Context);
  if (!value) throw new Error("useDrafts must be used inside DraftsProvider");
  return value;
}
