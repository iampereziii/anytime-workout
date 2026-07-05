import { Chat } from "@/components/chat/Chat";
import { TodayStatus } from "@/components/chat/TodayStatus";

/** Home: today status + chat (Flows 1–3, 6–9). Auth is enforced by middleware.ts. */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-4">
      <TodayStatus />
      <Chat />
    </main>
  );
}
