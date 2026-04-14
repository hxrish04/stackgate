import "./globals.css";
import { Manrope, Space_Grotesk } from "next/font/google";
import { AppShell } from "@/components/app-shell";

const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
});

const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${displayFont.variable}`}>
      <head>
        <title>StackGate</title>
        <meta
          name="description"
          content="AI-assisted PostgreSQL provisioning platform for internal developer workflows and approval-aware database delivery."
        />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
