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
  metadataBase: new URL("https://www.fairplayfootball.co.uk"),
  title: {
    default: "Fair Play Football | Casual Football in North London",
    template: "%s | Fair Play Football",
  },
  applicationName: "Fair Play Football",
  description:
    "Join friendly 6v6, 7v7 and 8v8 casual football games across North London. Book your spot, join the waiting list and manage your games online.",
  openGraph: {
    title: "Fair Play Football | Casual Football in North London",
    description:
      "Join friendly 6v6, 7v7 and 8v8 casual football games across North London. Book your spot, join the waiting list and manage your games online.",
    siteName: "Fair Play Football",
    type: "website",
    locale: "en_GB",
  },
  twitter: {
    card: "summary",
    title: "Fair Play Football | Casual Football in North London",
    description:
      "Join friendly 6v6, 7v7 and 8v8 casual football games across North London. Book your spot, join the waiting list and manage your games online.",
  },
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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
