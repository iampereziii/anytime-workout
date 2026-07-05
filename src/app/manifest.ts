import type { MetadataRoute } from "next";

/** PWA manifest — served at /manifest.webmanifest (already public in middleware.ts). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Any Time Workout",
    short_name: "ATW",
    description: "AI workout companion grounded in your real history",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#059669",
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
