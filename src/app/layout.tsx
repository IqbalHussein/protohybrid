import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProtoHybrid",
  description: "Plan and track lifting and running as one training load.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
