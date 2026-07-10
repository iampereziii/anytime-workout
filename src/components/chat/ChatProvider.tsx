"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

/**
 * Chat state, lifted above the route boundary so it survives `/` ↔ `/log`
 * navigation AND a page reload (feature brief: persist-chat-across-log-switch).
 *
 * Session-scoped, NOT durable history: backed by `sessionStorage`, so the
 * conversation lives for the tab's lifetime and clears on tab-close or the
 * explicit New chat action. Nothing touches the DB or the server — the v1
 * "no durable chat history" line still holds; only the reset-on-navigation
 * (and reset-on-reload) goes away.
 */

export interface Message {
  role: "user" | "assistant";
  content: string;
}

const STORAGE_KEY = "atw.chat.v1";

interface ChatContextValue {
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  clear: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/** Read + shape-guard the persisted conversation. Corrupt/oversized values fail safe to empty. */
function loadPersisted(): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is Message =>
        typeof m === "object" &&
        m !== null &&
        (("role" in m && (m.role === "user" || m.role === "assistant")) as boolean) &&
        "content" in m &&
        typeof (m as { content: unknown }).content === "string",
    );
  } catch {
    return [];
  }
}

export function ChatProvider({ children }: { children: ReactNode }) {
  // Start empty so server and first client render match; hydrate from storage
  // after mount to avoid an SSR/client markup mismatch.
  const [messages, setMessages] = useState<Message[]>([]);
  const hydrated = useRef(false);

  useEffect(() => {
    // One-time hydration from a client-only store. Reading in a lazy useState
    // initializer instead would render loaded messages on the client but []
    // on the server (no sessionStorage), causing a hydration mismatch — so we
    // render empty to match SSR, then populate after mount. setState here is
    // the sanctioned two-phase-hydration exception to the rule below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages(loadPersisted());
    hydrated.current = true;
  }, []);

  // Persist on change, debounced: during streaming `messages` updates once per
  // chunk, so a short debounce coalesces those into a single write near
  // turn-complete (feature brief Risk #5) instead of thrashing sessionStorage.
  useEffect(() => {
    if (!hydrated.current) return; // never overwrite storage with the pre-hydration empty state
    const id = window.setTimeout(() => {
      try {
        if (messages.length === 0) window.sessionStorage.removeItem(STORAGE_KEY);
        else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
      } catch {
        // storage full/unavailable — degrade to in-memory only, chat still works
      }
    }, 300);
    return () => window.clearTimeout(id);
  }, [messages]);

  const clear = useCallback(() => setMessages([]), []);

  const value = useMemo<ChatContextValue>(
    () => ({ messages, setMessages, clear }),
    [messages, clear],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within a ChatProvider");
  return ctx;
}
