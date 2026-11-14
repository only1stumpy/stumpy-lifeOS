import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { KeyboardAvoidance } from "./keyboard-avoidance";

export const metadata: Metadata = {
  title: "LifeOS",
  description: "Питание, финансы и тренировки в одном месте",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content",
  themeColor: "#f6f2ec", colorScheme: "light",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body><Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" /><KeyboardAvoidance />{children}</body></html>;
}

