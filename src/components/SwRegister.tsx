"use client";

import { useEffect } from "react";

/**
 * Registers the hand-rolled service worker (public/sw.js) for the PWA app
 * shell (challenge #1). Zero-dependency approach per the Next.js official PWA
 * guide — re-verify current SW tooling when the currency check runs (spec
 * Conventions #9; the 2026-07-05 WebSearch attempt was rate-limited).
 */
export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Non-fatal: the app works without the SW; offline shell just won't cache.
      });
    }
  }, []);
  return null;
}
