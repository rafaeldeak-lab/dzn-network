import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { BetaTicker } from "@/components/site/beta-ticker";
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
  title: "DZN Network | DayZ Server Competition Platform",
  description:
    "DZN Network connects DayZ servers, live ADM stats, server-vs-server leaderboards, factions, and community reputation in one premium competition hub.",
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
      <body className="min-h-full bg-[#02030a] text-zinc-100">
        {children}
        <BetaTicker />
      </body>
    </html>
  );
}
