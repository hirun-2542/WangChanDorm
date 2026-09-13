import { Hono } from "hono";

const health = new Hono<{ Bindings: Env }>();

health.get("/", async (c) => {
  const checks: { d1: string; r2: string } = { d1: "ok", r2: "ok" };

  try {
    await c.env.DB.prepare("SELECT 1").first();
  } catch (error) {
    checks.d1 = error instanceof Error ? error.message : "error";
    console.error(JSON.stringify({ message: "health check failed", check: "d1", error: checks.d1 }));
  }

  try {
    await c.env.SLIPS.list({ limit: 1 });
  } catch (error) {
    checks.r2 = error instanceof Error ? error.message : "error";
    console.error(JSON.stringify({ message: "health check failed", check: "r2", error: checks.r2 }));
  }

  const ok = checks.d1 === "ok" && checks.r2 === "ok";

  return c.json({ ok, time: new Date().toISOString(), checks }, ok ? 200 : 503);
});

export default health;
