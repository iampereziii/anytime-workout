import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SwRegister } from "@/components/SwRegister";
import { ChatProvider } from "@/components/chat/ChatProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Any Time Workout",
  description: "AI workout companion grounded in your real history",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Any Time Workout" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // cover → the page draws under the notch/home indicator, which is what makes
  // env(safe-area-inset-*) report nonzero. The chat jump-to-bottom button reads
  // safe-area-inset-bottom for its offset; without this it would always see 0.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* ChatProvider lives above every route so the chat session survives
            / ↔ /log navigation and reload (session-scoped, see ChatProvider). */}
        <ChatProvider>{children}</ChatProvider>
        <SwRegister />
      </body>
    </html>
  );
}
