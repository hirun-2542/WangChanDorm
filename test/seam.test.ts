import { SELF, env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

const seamProbeUrl = "https://dorm.test/api/seam-probe";
const outboundUrl = "https://outbound.test/seam-probe";

interface SeamProbeBody {
  ok: boolean;
  d1: { written: string; readBack: string | null };
  r2: { key: string; readBack: string | null };
  outbound: { status: number; body: string };
}

interface OutboundCall {
  url: string;
  method: string | undefined;
  body: string;
}

function readRequestBody(url: string, init: RequestInit): string {
  return init.body as string;
}

describe("POST /api/seam-probe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips d1, r2 and the outbound request", async () => {
    const received: OutboundCall[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      received.push({ url, method: init?.method, body: readRequestBody(url, init ?? {}) });
      return Promise.resolve(
        new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });

    const response = await SELF.fetch(seamProbeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outboundUrl }),
    });

    expect(response.status).toBe(200);

    const body = await response.json<SeamProbeBody>();
    expect(body.ok).toBe(true);
    expect(body.d1.readBack).toBe(body.d1.written);
    expect(body.r2.readBack).toBe(body.d1.written);
    expect(received).toHaveLength(1);

    const outbound = received[0];
    expect(outbound?.url).toBe(outboundUrl);
    expect(outbound?.method).toBe("POST");
    expect(JSON.parse(outbound?.body ?? "")).toEqual({ probe: body.d1.written });
    expect(JSON.parse(body.outbound.body)).toEqual({ received: true });
    expect(await env.SLIPS.get(body.r2.key)).toBeNull();
  });

  it("rejects an outbound url that is not http or https", async () => {
    const response = await SELF.fetch(seamProbeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outboundUrl: "ftp://x" }),
    });

    expect(response.status).toBe(400);
  });
});
