import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

const seamProbeUrl = "https://dorm.test/api/seam-probe";
const outboundUrl = "https://outbound.test/seam-probe";

interface SeamProbeBody {
  ok: boolean;
  d1: { written: string; readBack: string | null };
  r2: { key: string; readBack: string | null };
  outbound: { status: number; body: string };
}

async function readRequestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  const request = input instanceof Request ? input : new Request(String(input), init);
  return request.text();
}

describe("POST /api/seam-probe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips d1, r2 and the outbound request", async () => {
    const received: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockImplementation(async (input, init) => {
      received.push(await readRequestBody(input, init));
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
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
    const outboundBody = received[0];
    expect(outboundBody).toBeDefined();
    expect(JSON.parse(outboundBody ?? "")).toEqual({ probe: body.d1.written });
    expect(body.outbound.status).toBe(200);
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
