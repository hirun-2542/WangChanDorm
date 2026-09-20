import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signIn, withAuth, type TestSession } from "./auth-helper";

const seamProbeUrl = "https://dorm.test/api/seam-probe";
const outboundUrl = "https://outbound.test/seam-probe";

interface SeamProbeBody {
  ok: boolean;
  d1: { written: string; readBack: string | null };
  r2: { key: string; readBack: string | null };
  outbound: { status: number };
}

interface OutboundCall {
  url: string;
  method: string | undefined;
  body: string;
}

let session: TestSession;

beforeEach(async () => {
  session = await signIn();
});

function readRequestBody(init: RequestInit): string {
  return init.body as string;
}

function probe(init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(
    seamProbeUrl,
    withAuth(session, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outboundUrl }),
      ...init,
    }),
  );
}

describe("POST /api/seam-probe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires a signed-in session", async () => {
    const response = await SELF.fetch(seamProbeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outboundUrl }),
    });

    expect(response.status).toBe(401);
    expect((await response.json<{ ok: boolean }>()).ok).toBe(false);
  });

  it("round-trips d1 and r2 and reports the outbound status only", async () => {
    const received: OutboundCall[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      received.push({ url, method: init?.method, body: readRequestBody(init ?? {}) });
      return Promise.resolve(
        new Response(JSON.stringify({ received: true, secret: "ปลายทางตอบอะไรก็ไม่ควรถูกส่งต่อ" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });

    const response = await probe();
    const text = await response.text();

    expect(response.status).toBe(200);

    const body = JSON.parse(text) as SeamProbeBody;
    expect(body.ok).toBe(true);
    expect(body.d1.readBack).toBe(body.d1.written);
    expect(body.r2.readBack).toBe(body.d1.written);
    expect(body.outbound).toEqual({ status: 200 });
    // เนื้อหาตอบกลับของปลายทางต้องไม่ถูกส่งต่อออกไป
    expect(text).not.toContain("received");
    expect(text).not.toContain("secret");

    expect(received).toHaveLength(1);

    const outbound = received[0];
    expect(outbound?.url).toBe(outboundUrl);
    expect(outbound?.method).toBe("POST");
    expect(JSON.parse(outbound?.body ?? "")).toEqual({ probe: body.d1.written });
    expect(await env.SLIPS.get(body.r2.key)).toBeNull();
  });

  it("rejects an outbound url that is not http or https", async () => {
    const response = await SELF.fetch(
      seamProbeUrl,
      withAuth(session, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outboundUrl: "ftp://x" }),
      }),
    );

    expect(response.status).toBe(400);
  });

  it("fails closed when SEAM_PROBE is not exactly 1", async () => {
    const bindings = env as unknown as { SEAM_PROBE: string };
    const original = bindings.SEAM_PROBE;

    bindings.SEAM_PROBE = "0";

    try {
      const response = await probe();
      expect(response.status).toBe(404);
      expect((await response.json<{ ok: boolean }>()).ok).toBe(false);
    } finally {
      bindings.SEAM_PROBE = original;
    }
  });
});
