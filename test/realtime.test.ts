import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/worker/index";
import { configurePayout, createFamily, signIn, withAuth, type TestSession } from "./auth-helper";

const roomsUrl = "https://dorm.test/api/rooms";
const tenantsUrl = "https://dorm.test/api/tenants";
const billsUrl = "https://dorm.test/api/bills";
const realtimeUrl = "https://dorm.test/api/realtime";
const lineUrl = "https://dorm.test/api/line";
const originHeader = "https://dorm.test";

interface Envelope {
  v: number;
  type: string;
  connectionId?: string;
  billId?: string;
  roomNumber?: string;
  tenantName?: string;
  period?: string;
  total?: number;
  methodLabel?: string;
  paidAt?: string;
  tenantId?: string;
  source?: string;
  joinedAt?: string;
}

/**
 * เปิด socket จริงผ่านเส้นทาง /api/realtime แล้วคืนตัวช่วยอ่านข้อความ
 *
 * ใช้ app.fetch + waitOnExecutionContext แทน SELF.fetch เพราะ SELF ไม่รอ
 * ctx.waitUntil ให้ (พิสูจน์แล้วว่า push ของเจ้าของยังไม่ทันวิ่งตอนคืนค่า)
 * และการยกระดับเป็น WebSocket ผ่าน app.fetch ให้ Response ที่มี webSocket
 * เหมือนที่เบราว์เซอร์ได้จริง
 */
async function openSocket(cookie: string): Promise<TestSocket> {
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(realtimeUrl, {
      headers: {
        cookie,
        upgrade: "websocket",
        connection: "upgrade",
        origin: originHeader,
      },
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);

  const socket = response.webSocket;

  if (socket === null) {
    throw new Error("expected a WebSocket upgrade response");
  }

  socket.accept();

  const messages: string[] = [];
  const waiters: ((value: string) => void)[] = [];
  const errors: unknown[] = [];

  socket.addEventListener("message", (event: MessageEvent) => {
    const data = typeof event.data === "string" ? event.data : "<binary>";
    const waiter = waiters.shift();

    if (waiter === undefined) {
      messages.push(data);
      return;
    }

    waiter(data);
  });
  socket.addEventListener("error", (event: Event) => {
    errors.push(event);
  });

  let closed = false;
  socket.addEventListener("close", () => {
    closed = true;
  });

  const nextMessage = (): Promise<string> => {
    const buffered = messages.shift();

    if (buffered !== undefined) {
      return Promise.resolve(buffered);
    }

    const { promise, resolve } = Promise.withResolvers<string>();
    waiters.push(resolve);
    return promise;
  };

  return {
    status: response.status,
    errors,
    isClosed: () => closed,
    close: () => {
      socket.close();
    },
    send: (data: string) => {
      socket.send(data);
    },
    nextMessage,
    envelope: async (): Promise<Envelope> => JSON.parse(await nextMessage()) as Envelope,
  };
}

interface TestSocket {
  status: number;
  errors: unknown[];
  isClosed: () => boolean;
  close: () => void;
  send: (data: string) => void;
  nextMessage: () => Promise<string>;
  envelope: () => Promise<Envelope>;
}

/** ยิงคำขอที่ไม่ใช่ WebSocket เพื่อตรวจด่านหน้า */
function handshake(cookie: string | null, origin?: string): Promise<Response> {
  const headers: Record<string, string> = {
    upgrade: "websocket",
    connection: "upgrade",
  };

  if (cookie !== null) {
    headers.cookie = cookie;
  }

  if (origin !== undefined) {
    headers.origin = origin;
  }

  return SELF.fetch(realtimeUrl, { headers });
}

let session: TestSession;

beforeEach(async () => {
  session = await signIn();
  await configurePayout();
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/api/realtime handshake", () => {
  it("answers 401 without a session cookie and 403 for a foreign origin", async () => {
    const anonymous = await handshake(null, originHeader);
    expect(anonymous.status).toBe(401);

    const foreign = await handshake(session.cookie, "https://evil.example");
    expect(foreign.status).toBe(403);
    expect((await foreign.json<{ error: { code: string } }>()).error.code).toBe("VALIDATION");

    const missingCookie = await handshake(null);
    expect(missingCookie.status).toBe(401);
  });

  it("answers 426 when the request is not an upgrade", async () => {
    const response = await SELF.fetch(realtimeUrl, withAuth(session));

    expect(response.status).toBe(426);
    expect((await response.json<{ error: { code: string } }>()).error.code).toBe("VALIDATION");
  });

  it("greets an accepted socket with a hello carrying its connection id", async () => {
    const socket = await openSocket(session.cookie);
    expect(socket.status).toBe(101);

    const hello = await socket.envelope();
    expect(hello).toMatchObject({ v: 1, type: "hello" });
    expect(typeof hello.connectionId).toBe("string");

    socket.close();
  });
});

describe("bill paid fan-out", () => {
  async function newRoom(roomNumber: string): Promise<string> {
    const response = await SELF.fetch(roomsUrl, {
      ...withAuth(session),
      method: "POST",
      headers: { ...(withAuth(session).headers as Record<string, string>), "content-type": "application/json" },
      body: JSON.stringify({ roomNumber, rent: 3500 }),
    });
    expect(response.status).toBe(201);

    return (await response.json<{ room: { id: string } }>()).room.id;
  }

  async function newTenant(roomId: string, fullName: string): Promise<void> {
    const response = await SELF.fetch(tenantsUrl, {
      ...withAuth(session),
      method: "POST",
      headers: { ...(withAuth(session).headers as Record<string, string>), "content-type": "application/json" },
      body: JSON.stringify({ fullName, phone: "081-234-5678", roomId, checkInDate: "2025-03-01" }),
    });
    expect(response.status).toBe(201);
  }

  async function unpaidBill(roomId: string): Promise<{ id: string; total: number }> {
    const generated = await SELF.fetch(`${billsUrl}/generate`, {
      ...withAuth(session),
      method: "POST",
      headers: { ...(withAuth(session).headers as Record<string, string>), "content-type": "application/json" },
      body: JSON.stringify({ period: "2026-09", entries: [{ roomId, waterCurrent: 12, electricCurrent: 22 }] }),
    });
    expect(generated.status).toBe(201);

    const bills = await generated.json<{ bills: { id: string; total: number }[] }>();
    const [bill] = bills.bills;

    if (bill === undefined) {
      throw new Error("expected a generated bill");
    }

    return bill;
  }

  function markPaid(billId: string, realtimeId: string | null, method = "cash"): Promise<Response> {
    const headers: Record<string, string> = {
      ...(withAuth(session).headers as Record<string, string>),
      "content-type": "application/json",
    };

    if (realtimeId !== null) {
      headers["x-realtime-id"] = realtimeId;
    }

    return SELF.fetch(`${billsUrl}/${billId}/mark-paid`, {
      method: "POST",
      headers,
      body: JSON.stringify({ method }),
    });
  }

  it("delivers the event to every other tab and skips the tab that pressed the button", async () => {
    const roomId = await newRoom("R801");
    await newTenant(roomId, "ผู้เช่า เรียลไทม์");
    const bill = await unpaidBill(roomId);

    const first = await openSocket(session.cookie);
    const second = await openSocket(session.cookie);
    const firstHello = await first.envelope();
    const secondHello = await second.envelope();

    expect(firstHello.connectionId).not.toBe(secondHello.connectionId);

    const response = await markPaid(bill.id, firstHello.connectionId ?? null);
    expect(response.status).toBe(200);

    const envelope = await second.envelope();
    expect(envelope).toMatchObject({
      v: 1,
      type: "bill-paid",
      billId: bill.id,
      roomNumber: "R801",
      tenantName: "ผู้เช่า เรียลไทม์",
      period: "2026-09",
      total: bill.total,
      methodLabel: "เงินสด",
    });
    expect(typeof envelope.paidAt).toBe("string");

    // แท็บต้นทางไม่ได้รับอะไรกลับมา — แต่ socket ยังเปิดอยู่ (ไม่ได้ถูกปิดทิ้ง)
    first.send("ping");
    expect(await first.nextMessage()).toBe("pong");
    expect(first.errors).toEqual([]);

    first.close();
    second.close();
  });

  it("reaches a socket of another session in the same family even when it never sent a request", async () => {
    const roomId = await newRoom("R802");
    await newTenant(roomId, "ผู้เช่า คนละแท็บ");
    const bill = await unpaidBill(roomId);

    const other = await signIn();
    const socket = await openSocket(other.cookie);
    await socket.envelope();

    const response = await markPaid(bill.id, null);
    expect(response.status).toBe(200);

    const envelope = await socket.envelope();
    expect(envelope.type).toBe("bill-paid");
    expect(envelope.roomNumber).toBe("R802");
    expect(envelope.methodLabel).toBe("เงินสด");

    socket.close();
  });

  it("keeps families apart — another family's sockets hear nothing", async () => {
    const roomId = await newRoom("R803");
    await newTenant(roomId, "ผู้เช่า ข้ามครอบครัว");
    const bill = await unpaidBill(roomId);

    const stranger = await signIn("owner", await createFamily("หอของอีกครอบครัว"));
    await configurePayout(stranger.familyId);

    const mine = await openSocket(session.cookie);
    const theirs = await openSocket(stranger.cookie);
    await mine.envelope();
    await theirs.envelope();

    const response = await markPaid(bill.id, null);
    expect(response.status).toBe(200);

    expect((await mine.envelope()).roomNumber).toBe("R803");

    // socket ของครอบครัวอื่นต้องไม่ได้รับ event: ยิง ping แล้วได้ pong กลับมา
    // เป็นข้อความถัดไป แปลว่าไม่มี event คั่นกลาง
    theirs.send("ping");
    expect(await theirs.nextMessage()).toBe("pong");

    mine.close();
    theirs.close();
  });
});

describe("tenant joined fan-out", () => {
  /** เพดานการรอแบบเดียวกับ describe ข้างบน — ไม่มี replay จึงต้องรอข้อความจริง */
  const envelopeWithin = async (socket: TestSocket): Promise<Envelope> =>
    Promise.race([
      socket.envelope(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("no tenant-joined envelope arrived")), 4000),
      ),
    ]);

  async function createRoomFor(roomNumber: string): Promise<string> {
    const response = await SELF.fetch(roomsUrl, {
      ...withAuth(session),
      method: "POST",
      headers: { ...(withAuth(session).headers as Record<string, string>), "content-type": "application/json" },
      body: JSON.stringify({ roomNumber, rent: 3500 }),
    });
    expect(response.status).toBe(201);

    return (await response.json<{ room: { id: string } }>()).room.id;
  }

  async function createTenantFor(roomId: string, fullName: string): Promise<string> {
    const response = await SELF.fetch(tenantsUrl, {
      ...withAuth(session),
      method: "POST",
      headers: { ...(withAuth(session).headers as Record<string, string>), "content-type": "application/json" },
      body: JSON.stringify({ fullName, phone: "081-234-5678", roomId, checkInDate: "2025-03-01" }),
    });
    expect(response.status).toBe(201);

    return (await response.json<{ tenant: { id: string } }>()).tenant.id;
  }

  it("tells every open tab when the owner links a tenant's LINE", async () => {
    const roomId = await createRoomFor("J901");
    const tenantId = await createTenantFor(roomId, "สมชาย เชื่อมใหม่");

    // ผู้ใช้ LINE ที่รอเชื่อมอยู่ (มาจากการที่เขาทักบอทเข้ามา)
    await env.DB.prepare(
      "INSERT INTO line_pending (line_user_id, family_id, display_name, last_message, last_seen_at) VALUES (?, ?, ?, NULL, datetime('now'))",
    )
      .bind("U-join-1", session.familyId, "สมชาย")
      .run();

    const socket = await openSocket(session.cookie);
    await socket.envelope();

    const response = await SELF.fetch(
      `${lineUrl}/pending/U-join-1/link`,
      {
        ...withAuth(session),
        method: "POST",
        headers: { ...(withAuth(session).headers as Record<string, string>), "content-type": "application/json" },
        body: JSON.stringify({ tenantId }),
      },
    );
    expect(response.status).toBe(200);

    const envelope = await envelopeWithin(socket);
    expect(envelope.type).toBe("tenant-joined");
    expect(envelope.roomNumber).toBe("J901");
    expect(envelope.tenantName).toBe("สมชาย เชื่อมใหม่");
    expect(envelope.source).toBe("owner");
    // ต้องมี joinedAt ที่ parse ได้ เพื่อให้ฝั่งเว็บแสดงเวลาได้
    expect(Number.isNaN(Date.parse(String(envelope.joinedAt)))).toBe(false);

    socket.close();
  });

  it("sends nothing when the link request is rejected", async () => {
    // ไม่มี pending แถวนี้ → 404 และต้องไม่มี event หลุดออกไป
    const socket = await openSocket(session.cookie);
    await socket.envelope();

    const rejected = await SELF.fetch(
      `${lineUrl}/pending/U-does-not-exist/link`,
      {
        ...withAuth(session),
        method: "POST",
        headers: { ...(withAuth(session).headers as Record<string, string>), "content-type": "application/json" },
        body: JSON.stringify({ tenantId: "00000000-0000-4000-8000-000000000009" }),
      },
    );
    expect(rejected.status).toBe(404);

    // ping แล้วได้ pong เป็นข้อความถัดไป = ไม่มี event คั่นกลาง
    socket.send("ping");
    expect(await socket.nextMessage()).toBe("pong");

    socket.close();
  });
});
