import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ThaiBan AI",
    short_name: "ThaiBan AI",
    description: "AI ส่วนตัวสำหรับการใช้งานของคุณ",
    id: "/",
    scope: "/",
    start_url: "/",
    display: "standalone",
    background_color: "#070b14",
    theme_color: "#0b1020",
    lang: "th",
    icons: [
      {
        src: "/icon.svg?v=3",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
