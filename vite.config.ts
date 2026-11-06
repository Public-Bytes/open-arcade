import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    target: "chrome116",
    rollupOptions: {
      input: {
        index: resolve("index.html"),
        popup: resolve("popup.html"),
        offscreen: resolve("offscreen.html"),
        permissions: resolve("permissions.html"),
        hud: resolve("hud.html"),
        background: resolve("src/extension/background.ts"),
        content: resolve("src/extension/content.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
