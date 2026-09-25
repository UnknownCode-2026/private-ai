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
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
