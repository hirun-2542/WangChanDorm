import { Hono } from "hono";

const api = new Hono<{ Bindings: Env }>();

api.get("/ping", (c) => c.json({ ok: true }));

api.post("/seam-probe", async (c) => {
  if (String(c.env.SEAM_PROBE) !== "1") {
    return c.json({ ok: false, error: "not found" }, 404);
  }

  let outboundUrl: string;

  try {
    const body = await c.req.json<{ outboundUrl?: string }>();
    outboundUrl = body.outboundUrl ?? "";
  } catch {
    return c.json({ ok: false, error: "invalid json body" }, 400);
  }

  let target: URL;

  try {
    target = new URL(outboundUrl);
  } catch {
    return c.json({ ok: false, error: "outboundUrl must be a valid url" }, 400);
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return c.json({ ok: false, error: "outboundUrl must use http or https" }, 400);
  }

  const value = crypto.randomUUID();
  const updatedAt = new Date().toISOString();
  const key = `seam-probe/${value}`;

  try {
    await c.env.DB.prepare(
      "INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
      .bind("seam-probe", value, updatedAt)
      .run();

    const row = await c.env.DB.prepare("SELECT value FROM meta WHERE key = ?")
      .bind("seam-probe")
      .first<{ value: string }>();

    await c.env.SLIPS.put(key, value);

    const object = await c.env.SLIPS.get(key);
    const objectText = object === null ? null : await object.text();

    await c.env.SLIPS.delete(key);

    const outboundResponse = await fetch(target.href, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ probe: value }),
    });
    const outboundBody = await outboundResponse.text();

    return c.json({
      ok: true,
      d1: { written: value, readBack: row?.value ?? null },
      r2: { key, readBack: objectText },
      outbound: { status: outboundResponse.status, body: outboundBody },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "seam probe failed", error: detail }));
    return c.json({ ok: false, error: "seam probe failed" }, 500);
  }
});

export default api;
