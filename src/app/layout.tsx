import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import { TimezoneSync } from "@/components/timezone-sync";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

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
    <html lang="en" className={archivo.variable}>
      <body className="min-h-screen">
        <TimezoneSync />
        {children}
      </body>
    </html>
  );
}
