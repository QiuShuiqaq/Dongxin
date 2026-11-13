import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    cssMinify: false,
    rollupOptions: {
      input: {
        operations: resolve(import.meta.dirname, "index.html"),
        lab: resolve(import.meta.dirname, "lab.html"),
      },
    },
  },
  server: { host: "127.0.0.1", port: 3020 },
});
