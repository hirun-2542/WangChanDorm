import { SELF, env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

const base = "https://dorm.test";
const enterUrl = `${base}/api/demo/enter`;

interface RoomPayload {
  id: string;
  roomNumber: string;
}

interface RoomListBody {
  ok: boolean;
  rooms: RoomPayload[];
}

interface BillPayload {
  roomNumber: string;
  status: "unpaid" | "paid";
}

interface BillListBody {
  ok: boolean;
  bills: BillPayload[];
}

interface SlipQueueItem {
  status: string;
  bill: { roomNumber: string; period: string } | null;
}

interface SlipQueueBody {
  ok: boolean;
  slips: SlipQueueItem[];
}

function periodOffset(monthsAgo: number): string {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
  return `${String(target.getUTCFullYear())}-${String(target.getUTCMonth() + 1).padStart(2, "0")}`;
}

const demoModeEnv = env as unknown as { DEMO_MODE: string };

async function enter(): Promise<Response> {
  return SELF.fetch(enterUrl, { redirect: "manual" });
}

function cookieOf(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

async function backdateActivity(minutesAgo: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO meta (key, value, updated_at) VALUES ('demo_last_activity_at', datetime('now', ?), datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(`-${String(minutesAgo)} minutes`)
    .run();
}

async function rooms(cookie: string): Promise<RoomPayload[]> {
  const response = await SELF.fetch(`${base}/api/rooms`, { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await response.json<RoomListBody>()).rooms;
}

async function billsOf(cookie: string, period: string): Promise<BillPayload[]> {
  const response = await SELF.fetch(`${base}/api/bills?period=${period}`, { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await response.json<BillListBody>()).bills;
}

async function slipQueue(cookie: string): Promise<SlipQueueItem[]> {
  const response = await SELF.fetch(`${base}/api/slips`, { headers: { cookie } });
  expect(response.status).toBe(200);
  return (await response.json<SlipQueueBody>()).slips;
}

describe("GET /api/demo/enter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    demoModeEnv.DEMO_MODE = "0";
  });

  it("fails closed when DEMO_MODE is not exactly 1, minting no session", async () => {
    demoModeEnv.DEMO_MODE = "0";

    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>();
    const response = await enter();

    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();

    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });

  it("mints a working session and redirects home when demo mode is on", async () => {
    demoModeEnv.DEMO_MODE = "1";

    const response = await enter();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${base}/`);

    const cookie = cookieOf(response);
    expect(cookie).toContain("wangchan_session=");

    const list = await rooms(cookie);
    expect(list.length).toBe(18);
  });

  it("seeds two months of bills in mixed states and leaves the current month empty", async () => {
    demoModeEnv.DEMO_MODE = "1";
    await backdateActivity(10);

    const cookie = cookieOf(await enter());

    const older = await billsOf(cookie, periodOffset(2));
    expect(older.length).toBe(15);
    expect(older.every((bill) => bill.status === "paid")).toBe(true);

    const recent = await billsOf(cookie, periodOffset(1));
    expect(recent.length).toBe(15);
    const unpaid = recent.filter((bill) => bill.status === "unpaid");
    const paid = recent.filter((bill) => bill.status === "paid");
    expect(unpaid.length).toBe(4);
    expect(paid.length).toBe(11);

    const current = await billsOf(cookie, periodOffset(0));
    expect(current.length).toBe(0);

    const queue = await slipQueue(cookie);
    const pending = queue.filter((slip) => slip.status === "pending_review");
    expect(pending.length).toBe(1);
    expect(pending[0]?.bill?.roomNumber).toBe("A105");
    expect(pending[0]?.bill?.period).toBe(periodOffset(1));
  });

  it("skips the reset when a request already arrived within the idle window", async () => {
    demoModeEnv.DEMO_MODE = "1";
    await backdateActivity(10);

    const first = cookieOf(await enter());

    const created = await SELF.fetch(`${base}/api/rooms`, {
      method: "POST",
      headers: { cookie: first, "content-type": "application/json" },
      body: JSON.stringify({ roomNumber: "ZZZ-DIRTY", rent: 9999 }),
    });
    expect(created.status).toBe(201);
    expect((await rooms(first)).length).toBe(19);

    const second = cookieOf(await enter());
    const afterImmediateReentry = await rooms(second);
    expect(afterImmediateReentry.length).toBe(19);
    expect(afterImmediateReentry.some((room) => room.roomNumber === "ZZZ-DIRTY")).toBe(true);
  });

  it("resets once the idle window has passed, discarding visitor edits", async () => {
    demoModeEnv.DEMO_MODE = "1";
    await backdateActivity(10);

    const first = cookieOf(await enter());
    const created = await SELF.fetch(`${base}/api/rooms`, {
      method: "POST",
      headers: { cookie: first, "content-type": "application/json" },
      body: JSON.stringify({ roomNumber: "ZZZ-STALE", rent: 9999 }),
    });
    expect(created.status).toBe(201);

    await backdateActivity(10);

    const second = cookieOf(await enter());
    const list = await rooms(second);
    expect(list.length).toBe(18);
    expect(list.some((room) => room.roomNumber === "ZZZ-STALE")).toBe(false);
  });

  it("makes no outbound network calls while entering or resetting", async () => {
    demoModeEnv.DEMO_MODE = "1";
    await backdateActivity(10);

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await enter();

    expect(response.status).toBe(302);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("GET /api/demo/status", () => {
  afterEach(() => {
    demoModeEnv.DEMO_MODE = "0";
  });

  it("reports demoMode false on the default config without requiring a session", async () => {
    demoModeEnv.DEMO_MODE = "0";

    const response = await SELF.fetch(`${base}/api/demo/status`);
    expect(response.status).toBe(200);
    expect((await response.json<{ ok: boolean; demoMode: boolean }>()).demoMode).toBe(false);
  });

  it("reports demoMode true when DEMO_MODE is on, still without requiring a session", async () => {
    demoModeEnv.DEMO_MODE = "1";

    const response = await SELF.fetch(`${base}/api/demo/status`);
    expect(response.status).toBe(200);
    expect((await response.json<{ ok: boolean; demoMode: boolean }>()).demoMode).toBe(true);
  });
});
