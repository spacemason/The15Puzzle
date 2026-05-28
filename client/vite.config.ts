import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// When the catalog host mounts this app under /<slug>/, it sets GAME_PATH
// (e.g. "/the15puzzle"). Bake that into the build so assets resolve at the
// correct prefix and `import.meta.env.BASE_URL` carries it at runtime.
const gamePath = process.env.GAME_PATH ?? "";
const base = gamePath ? `${gamePath.replace(/\/$/, "")}/` : "/";

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/uploads": "http://127.0.0.1:3001",
    },
  },
});
