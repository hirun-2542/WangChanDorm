import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

interface HealthBody {
  ok: boolean;
  time: string;
  checks: { d1: string; r2: string };
}

describe("GET /health", () => {
  it("proves the d1 and r2 bindings are reachable", async () => {
    const response = await SELF.fetch("https://dorm.test/health");

    expect(response.status).toBe(200);

    const body = await response.json<HealthBody>();
    expect(body.ok).toBe(true);
    expect(body.checks.d1).toBe("ok");
    expect(body.checks.r2).toBe("ok");
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });
});
