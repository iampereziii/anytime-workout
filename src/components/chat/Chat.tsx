"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useChat } from "@/components/chat/ChatProvider";
import { cn } from "@/lib/utils";

/**
 * Chat UI — answers stream from /api/chat as plain text. Messages are
 * SESSION-SCOPED (see ChatProvider): held above the route so the conversation
 * survives / ↔ /log navigation and reload, cleared on tab-close or New chat.
 * Last turns are sent back as context; nothing touches the DB or server.
 */

const MAX_HISTORY_TURNS = 8;

export function Chat() {
  const { messages, setMessages, clear } = useChat();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function send() {
    const question = input.trim();
    if (!question || busy) return;
    setBusy(true);
    setInput("");
    const history = messages.slice(-MAX_HISTORY_TURNS);
    setMessages((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "" }]);

    const appendToLast = (text: string) =>
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: next[next.length - 1].content + text };
        return next;
      });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
        appendToLast(`⚠ ${json?.error?.message ?? "Something went wrong — try again."}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        appendToLast(decoder.decode(value, { stream: true }));
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    } catch {
      appendToLast("⚠ Network error — chat needs a connection (logging works offline).");
    } finally {
      setBusy(false);
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }

  return (
    <section className="flex flex-1 flex-col gap-3">
      {messages.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={clear}
            disabled={busy}
            className="text-xs font-medium text-zinc-400 hover:text-zinc-600 disabled:opacity-40 dark:hover:text-zinc-200"
          >
            New chat
          </button>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {messages.length === 0 && (
          <p className="mt-6 text-center text-sm text-zinc-400">
            Ask anything — “what’s left today?”, “I only have 20 minutes and dumbbells”, “ready for a PR attempt?”
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
              m.role === "user"
                ? "self-end bg-emerald-600 text-white"
                : "self-start bg-zinc-100 dark:bg-zinc-800",
            )}
          >
            {m.content || (busy && i === messages.length - 1 ? "…" : "")}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask your coach…"
          className="w-full rounded-full border border-zinc-300 bg-transparent px-4 py-2.5 text-base outline-none placeholder:text-zinc-400 focus:border-emerald-500 dark:border-zinc-700"
        />
        <Button type="submit" disabled={busy || !input.trim()} className="rounded-full">
          {busy ? "…" : "Send"}
        </Button>
      </form>
    </section>
  );
}
