import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Private AI",
    short_name: "Private AI",
    description: "ผู้ช่วย AI ส่วนตัวสำหรับมือถือ",
    start_url: "/",
    display: "standalone",
    background_color: "#070b14",
    theme_color: "#0b1020",
    lang: "th",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
