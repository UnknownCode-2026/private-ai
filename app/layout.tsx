import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ThaiBan AI",
  description: "AI ส่วนตัวสำหรับการใช้งานของคุณ",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  applicationName: "ThaiBan AI",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ThaiBan AI",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b1020",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
