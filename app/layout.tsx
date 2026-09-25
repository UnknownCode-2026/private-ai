import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Private AI",
  description: "ผู้ช่วย AI ส่วนตัวสำหรับมือถือ",
  applicationName: "Private AI",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Private AI",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
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
