import { Hono } from "hono";
import { errorBody } from "./shared";

export const slipsRoute = new Hono<{ Bindings: Env }>();

const filePattern = /^[A-Za-z0-9_-]+\.(png|jpg|jpeg)$/;

slipsRoute.get("/:file", async (c) => {
  const file = c.req.param("file");

  if (!filePattern.test(file)) {
    return c.json(errorBody("NOT_FOUND", "ไม่พบรูปสลิปที่ต้องการ"), 404);
  }

  try {
    const object = await c.env.SLIPS.get(file);

    if (object === null) {
      return c.json(errorBody("NOT_FOUND", "ไม่พบรูปสลิปที่ต้องการ"), 404);
    }

    return c.body(object.body, 200, {
      "content-type": object.httpMetadata?.contentType ?? "image/png",
      "cache-control": "public, max-age=86400",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "serve slip image failed", imageKey: file, error: detail }));
    return c.json(errorBody("INTERNAL", "โหลดรูปสลิปไม่สำเร็จ"), 500);
  }
});

export default slipsRoute;
