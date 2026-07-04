import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sah-Ayak · v2 Console",
  description: "Payments · Legal · Field — v2 gap modules for the SKVCB loan-recovery agent",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
