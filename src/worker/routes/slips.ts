import { Hono } from "hono";
import type { AppEnv } from "../lib/auth";
import { familyId, requireAuth } from "../lib/auth";
import { errorBody } from "./shared";

export const slipsRoute = new Hono<AppEnv>();

const filePattern = /^[A-Za-z0-9_-]+\.(png|jpg|jpeg)$/;

/**
 * รูปสลิปมีเลขบัญชี ชื่อ และยอดโอนของผู้เช่า จึงต้องล็อกอินก่อนดูเสมอ และ
 * ต้องเป็นรูปของครอบครัวตัวเองเท่านั้น — คีย์สุ่ม 128-bit เดาไม่ได้ก็จริง แต่
 * เดาไม่ได้ไม่เท่ากับปลอดภัย ถ้าลิงก์รั่วออกไป (แชร์ผิด, log, proxy) ใครถือ
 * ลิงก์ก็ดูรูปได้ตลอดกาลโดยไม่ต้องล็อกอิน จึงเปลี่ยนมาบังคับ session ด้วย
 */
slipsRoute.get("/:file", requireAuth, async (c) => {
  const file = c.req.param("file");

  if (!filePattern.test(file)) {
    return c.json(errorBody("NOT_FOUND", "ไม่พบรูปสลิปที่ต้องการ"), 404);
  }

  try {
    const owned = await c.env.DB.prepare(
      "SELECT 1 AS one FROM slips WHERE family_id = ? AND image_key = ?",
    )
      .bind(familyId(c), file)
      .first<{ one: number }>();

    if (owned === null) {
      return c.json(errorBody("NOT_FOUND", "ไม่พบรูปสลิปที่ต้องการ"), 404);
    }

    const object = await c.env.SLIPS.get(file);

    if (object === null) {
      return c.json(errorBody("NOT_FOUND", "ไม่พบรูปสลิปที่ต้องการ"), 404);
    }

    return c.body(object.body, 200, {
      "content-type": object.httpMetadata?.contentType ?? "image/png",
      "cache-control": "private, no-store",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "serve slip image failed", imageKey: file, error: detail }));
    return c.json(errorBody("INTERNAL", "โหลดรูปสลิปไม่สำเร็จ"), 500);
  }
});

export default slipsRoute;
