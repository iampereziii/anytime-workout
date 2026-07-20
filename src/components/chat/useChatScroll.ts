"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Message } from "@/components/chat/ChatProvider";

/**
 * Scroll behavior for the coach chat (feature brief: chat-scroll-navigation).
 *
 * NOTE ON SCROLL MODEL: this page scrolls the *viewport*, not an inner element.
 * The chat's `overflow-y-auto` div is never height-bounded (body is `min-h-full`
 * with no fixed shell), so TodayStatus + EquipmentPicker + chat flow and scroll
 * together. Everything here is therefore viewport-relative: `IntersectionObserver`
 * with `root: null`, `window` scroll for retention, and a `fixed` button.
 *
 * Owns:
 *  - at-bottom detection via the bottom sentinel entering the viewport
 *    (`rootMargin` is the "near bottom" threshold, brief Gap #3);
 *  - a `hasNew` flag so the button can surface a "↓ new" pill when a reply
 *    streams in while the user has scrolled up;
 *  - sticky scroll retention across `Chat` remount (/ ↔ /log nav) and reload,
 *    persisted to `sessionStorage` as a plain number — never React state, so
 *    scrolling never triggers a re-render.
 */

const SCROLL_KEY = "atw.chat.scroll.v1";
/** Within this many px of the bottom still counts as "at bottom" (brief Gap #3). */
const NEAR_BOTTOM_PX = 100;

// useLayoutEffect on the client (restore scroll before paint → no top-then-jump
// flash); fall back to useEffect on the server to avoid the SSR warning.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Wipe the saved offset — call when the conversation is reset (New chat). */
export function clearChatScroll() {
  try {
    window.sessionStorage.removeItem(SCROLL_KEY);
  } catch {
    // storage unavailable — nothing to clear
  }
}

export function useChatScroll(messages: Message[]) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);

  // Mirror atBottom into a ref so the streaming loop reads the fresh value
  // without re-creating its callback each render. Written from the observer
  // callback below (never during render).
  const atBottomRef = useRef(atBottom);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  /** Follow the stream only while the user is pinned to the bottom (no-yank). */
  const followIfPinned = useCallback(() => {
    if (atBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // At-bottom detection against the viewport. rootMargin extends the viewport's
  // bottom edge by NEAR_BOTTOM_PX so the sentinel still "intersects" within the
  // threshold.
  useEffect(() => {
    const sentinel = bottomRef.current;
    if (!sentinel) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        const isAtBottom = entry.isIntersecting;
        atBottomRef.current = isAtBottom;
        setAtBottom(isAtBottom);
        if (isAtBottom) setHasNew(false); // back at the bottom → nothing unread below
      },
      { root: null, rootMargin: `0px 0px ${NEAR_BOTTOM_PX}px 0px`, threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  // Content changed (new message or a streamed chunk) while scrolled up →
  // there's more below. Idempotent once true, so per-chunk fires are cheap.
  useEffect(() => {
    if (messages.length > 0 && !atBottomRef.current) setHasNew(true);
  }, [messages]);

  // Persist the window scroll offset, coalesced to one write per frame.
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        try {
          window.sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
        } catch {
          // storage full/unavailable — retention degrades, chat still works
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Restore once, after messages first render. If nothing was saved, default to
  // the newest message (sensible chat default rather than a cold start at top).
  const restored = useRef(false);
  useIsoLayoutEffect(() => {
    if (restored.current || messages.length === 0) return; // wait until there's content
    restored.current = true;
    let saved: number | null = null;
    try {
      const raw = window.sessionStorage.getItem(SCROLL_KEY);
      if (raw !== null) saved = Number(raw);
    } catch {
      saved = null;
    }
    if (saved !== null && Number.isFinite(saved)) {
      window.scrollTo(0, saved);
    } else {
      bottomRef.current?.scrollIntoView();
    }
  }, [messages]);

  return { bottomRef, atBottom, hasNew, scrollToBottom, followIfPinned };
}
