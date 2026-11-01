import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Long-Running Agent Execution",
  description: "Langdock platform engineering assignment",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
