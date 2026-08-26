import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ConvexClientProvider } from "./convex-provider";
import { AppAuthProvider } from "@/lib/app-auth";
import { AnalyticsProvider } from "@/lib/analytics-provider";
import { LocalSetupGate } from "./local-setup-gate";
import { ThemeSync } from "@/components/ThemeToggle";
import { ToasterProvider } from "@/components/ToasterProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BigSet",
  description: "Live, queryable datasets by TinyFish",
};

/**
 * Inline script: resolve theme BEFORE React hydrates so we never paint
 * the wrong palette and then flip. Reads `bigset:theme` from localStorage,
 * falls back to the OS preference. Sets `<html data-theme>` synchronously.
 *
 * Kept as a string and injected via `dangerouslySetInnerHTML` because Next
 * inlines it as-is into `<head>` — Script components defer execution and
 * would re-introduce the flicker.
 */
const themeInitScript = `(function(){try{var s=localStorage.getItem('bigset:theme');var t=s==='dark'||s==='light'?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col theme-transition">
        <ThemeSync />
        <AppAuthProvider>
          <ConvexClientProvider>
<AnalyticsProvider>
              <LocalSetupGate>{children}</LocalSetupGate>
              <ToasterProvider />
            </AnalyticsProvider>
          </ConvexClientProvider>
        </AppAuthProvider>
      </body>
    </html>
  );
}
