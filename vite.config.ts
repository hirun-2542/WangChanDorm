import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist/client",
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
      "/slips": "http://127.0.0.1:8787",
      "/qr": "http://127.0.0.1:8787",
      "/invoices": "http://127.0.0.1:8787",
    },
  },
});
