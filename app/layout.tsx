import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
  title: "Reservation Alerts",
  description: "Get notified when reservations become available",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <nav className="bg-white shadow-sm border-b border-gray-200">
          <div className="max-w-6xl mx-auto px-6 py-3">
            <div className="flex items-center gap-6">
              <Link
                href="/"
                className="text-gray-700 hover:text-purple-600 font-medium transition-colors"
              >
                House of Prime Rib
              </Link>
              <Link
                href="/bbb"
                className="text-gray-700 hover:text-pink-600 font-medium transition-colors"
              >
                Bibbidi Bobbidi Boutique
              </Link>
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
