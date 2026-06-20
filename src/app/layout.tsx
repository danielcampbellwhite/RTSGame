import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "World Dominion",
  description: "A persistent real-time geopolitical grand strategy game.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
