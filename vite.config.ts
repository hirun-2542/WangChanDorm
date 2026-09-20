import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * ตอน dev แอปถูกเสิร์ฟจาก vite (5173) คนละ origin กับ Worker (8787) แล้ว proxy
 * ส่งต่อไปให้ Worker — ค่าเริ่มต้นของ proxy คือเขียน Host header เป็นปลายทาง
 * ซึ่งทำให้ Worker มองว่า origin ของตัวเองคือ http://127.0.0.1:8787 ขณะที่
 * เบราว์เซอร์ส่ง Origin: http://localhost:5173 มา ผลคือ middleware ตรวจ CSRF
 * (`sameOriginOnly` ใน `src/worker/lib/auth.ts`) ปฏิเสธทุกคำขอที่เปลี่ยนข้อมูล
 * รวมถึงการล็อกอิน ด้วย 403 "คำขอมาจากต้นทางที่ไม่ได้รับอนุญาต"
 *
 * production ไม่มีปัญหานี้เพราะแอปกับ `/api` อยู่ origin เดียวกัน จึงแก้ที่ proxy
 * ให้เก็บ Host เดิมของเบราว์เซอร์ไว้ (`changeOrigin: false`) เพื่อให้ dev
 * เหมือน production แทนที่จะไปผ่อนการตรวจ CSRF ฝั่ง Worker ซึ่งจะอ่อนแอจริง
 */
const apiTarget = "http://127.0.0.1:8787";

const apiProxy = {
  target: apiTarget,
  changeOrigin: false,
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist/client",
  },
  server: {
    proxy: {
      "/api": apiProxy,
      "/health": apiProxy,
      "/slips": apiProxy,
      "/qr": apiProxy,
      "/invoices": apiProxy,
    },
  },
});
