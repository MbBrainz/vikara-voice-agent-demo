import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "Vikara — Voice AI Scheduling Agent",
  description:
    "Schedule a product demo in seconds with Vikara, an AI-powered voice agent.",
  openGraph: {
    title: "Vikara — Voice AI Scheduling Agent",
    description: "Schedule a product demo in seconds with our voice AI agent.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-svh bg-background font-sans antialiased`}
      >
        <noscript>
          <p style={{ textAlign: "center", padding: "2rem", color: "#a1a1aa" }}>
            JavaScript is required to use this voice agent.
          </p>
        </noscript>
        {children}
      </body>
    </html>
  );
}
