import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { buildInvoiceDocument, buildInvoiceRows, type InvoiceBill } from "../src/worker/lib/invoice";
import {
  buildPromptPayPayload,
  crc16CcittFalse,
  crc16CcittFalseHex,
  isValidPromptPayPayload,
  promptPayMerchantTarget,
  promptPayPayloadChecksum,
} from "../src/worker/lib/promptpay";
import { createFamily, signIn, withAuth, type TestSession } from "./auth-helper";

interface RoomPayload {
  id: string;
  roomNumber: string;
}

interface TenantPayload {
  id: string;
  fullName: string;
}

interface BillPayload {
  id: string;
  roomId: string;
  total: number;
  charges: { name: string; amount: number }[];
}

interface ErrorBody {
  ok: boolean;
  error: { code: string; message: string };
}

const roomsUrl = "https://dorm.test/api/rooms";
const tenantsUrl = "https://dorm.test/api/tenants";
const billsUrl = "https://dorm.test/api/bills";
const settingsUrl = "https://dorm.test/api/settings";

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let session: TestSession;

/** ยิง API ภายใต้ /api ด้วยเซสชันของเทสต์นี้ ส่วน /qr และ /invoices ยังเปิดสาธารณะ */
function api(url: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(url, withAuth(session, init));
}

beforeEach(async () => {
  session = await signIn();
});

function post(url: string, payload: Record<string, unknown>): Promise<Response> {
  return api(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function first<T>(items: T[]): T {
  const [item] = items;

  if (item === undefined) {
    throw new Error("expected at least one item");
  }

  return item;
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function chunkTypeAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

async function putIssuer(promptpayType: "phone" | "citizen-id" = "phone"): Promise<void> {
  const response = await api(settingsUrl, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dormName: "หอพักวังจันทร์",
      ownerName: "สมศักดิ์ ใจดี",
      promptpayType,
      promptpayId: promptpayType === "phone" ? "081-234-5678" : "1234567890123",
      promptpayName: "สมศักดิ์ ใจดี",
      defaultWaterRate: 18,
      defaultElectricRate: 7,
    }),
  });

  expect(response.status).toBe(200);
}

async function occupiedRoom(roomNumber: string, payload: Record<string, unknown> = {}): Promise<RoomPayload> {
  const created = await post(roomsUrl, { roomNumber, rent: 3500, ...payload });
  expect(created.status).toBe(201);

  const room = (await created.json<{ ok: boolean; room: RoomPayload }>()).room;
  const tenant = await post(tenantsUrl, {
    fullName: `ผู้เช่า ${roomNumber}`,
    phone: "081-234-5678",
    roomId: room.id,
    checkInDate: "2025-03-01",
  });
  expect(tenant.status).toBe(201);
  expect((await tenant.json<{ ok: boolean; tenant: TenantPayload }>()).tenant.id.length).toBeGreaterThan(0);

  return room;
}

async function generatedBill(roomId: string, entry: Record<string, unknown>, period = "2026-09"): Promise<BillPayload> {
  const response = await post(`${billsUrl}/generate`, { period, entries: [{ roomId, ...entry }] });
  expect(response.status).toBe(201);
  return first((await response.json<{ ok: boolean; bills: BillPayload[] }>()).bills);
}

/** สร้างห้องที่มีผู้เช่าในครอบครัวของเซสชันที่ส่งเข้ามา (ใช้เทสต์ข้ามครอบครัว) */
async function occupiedRoomFor(owner: TestSession, roomNumber: string): Promise<RoomPayload> {
  const roomResponse = await SELF.fetch(
    roomsUrl,
    withAuth(owner, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomNumber, rent: 3500, waterMeterInit: 10, electricMeterInit: 20 }),
    }),
  );
  expect(roomResponse.status).toBe(201);

  const room = (await roomResponse.json<{ ok: boolean; room: RoomPayload }>()).room;
  const tenantResponse = await SELF.fetch(
    tenantsUrl,
    withAuth(owner, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName: `ผู้เช่า ${roomNumber}`, phone: "081-234-5678", roomId: room.id, checkInDate: "2025-03-01" }),
    }),
  );
  expect(tenantResponse.status).toBe(201);

  return room;
}

async function generatedBillFor(owner: TestSession, roomId: string, period = "2026-09"): Promise<BillPayload> {
  const response = await SELF.fetch(
    `${billsUrl}/generate`,
    withAuth(owner, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ period, entries: [{ roomId, waterCurrent: 18, electricCurrent: 40 }] }),
    }),
  );
  expect(response.status).toBe(201);

  return first((await response.json<{ ok: boolean; bills: BillPayload[] }>()).bills);
}

function patchBill(id: string, payload: Record<string, unknown>): Promise<Response> {
  return api(`${billsUrl}/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function qrUrl(billId: string): string {
  return `https://dorm.test/qr/${billId}.png`;
}

function invoiceUrl(billId: string): string {
  return `https://dorm.test/invoices/${billId}.pdf`;
}

const meteredBill: InvoiceBill = {
  roomNumber: "A101",
  tenantName: "พิชญ์สินี ยีปา",
  period: "2026-09",
  rent: 3800,
  waterPrevious: 100,
  waterCurrent: 105,
  waterUnits: 5,
  waterRate: 18,
  waterAmount: 90,
  electricMode: "meter",
  electricPrevious: 240,
  electricCurrent: 301,
  electricUnits: 61,
  electricRate: 6,
  electricAmount: 366,
  charges: [
    { name: "ค่าจัดเก็บขยะ", amount: 30 },
    { name: "ค่า WiFi", amount: 100 },
  ],
  total: 4386,
  createdAt: "2026-09-15 15:16:45",
};

const flatBill: InvoiceBill = {
  roomNumber: "A109",
  tenantName: "อารีย์ วงศ์ไทย",
  period: "2026-09",
  rent: 3900,
  waterPrevious: 20,
  waterCurrent: 24,
  waterUnits: 4,
  waterRate: 18,
  waterAmount: 72,
  electricMode: "flat",
  electricPrevious: 460,
  electricCurrent: 470,
  electricUnits: null,
  electricRate: null,
  electricAmount: 600,
  charges: [],
  total: 4572,
  createdAt: "2026-09-16",
};

describe("promptpay payload", () => {
  it("computes the published CRC16-CCITT test vector", () => {
    expect(crc16CcittFalse("123456789")).toBe(0x29b1);
    expect(crc16CcittFalseHex("123456789")).toBe("29B1");
    expect(crc16CcittFalse("")).toBe(0xffff);
  });

  it("matches the reference payload for a phone merchant and an amount", () => {
    const payload = buildPromptPayPayload("phone", "081-234-5678", 4314);

    expect(payload).toBe("00020101021229370016A000000677010111011300668123456785802TH530376454074314.006304779F");
    expect(promptPayMerchantTarget("phone", "081-234-5678")).toBe("0066812345678");
    expect(payload).toContain("A000000677010111");
    expect(payload).toContain("0066812345678");
    expect(payload).toContain("4314.00");
    expect(payload).toContain("5303764");
    expect(payload).toContain("5802TH");
    expect(payload.slice(-4)).toBe(promptPayPayloadChecksum(payload));
    expect(isValidPromptPayPayload(payload)).toBe(true);
  });

  it("matches the reference payload for a citizen id merchant", () => {
    const payload = buildPromptPayPayload("citizen-id", "1234567890123", 3745);

    expect(payload).toBe("00020101021229370016A000000677010111021312345678901235802TH530376454073745.0063042508");
    expect(promptPayMerchantTarget("citizen-id", "1234567890123")).toBe("1234567890123");
    expect(isValidPromptPayPayload(payload)).toBe(true);
    expect(payload).not.toContain("00661234567890123");
  });

  it("rejects a payload whose checksum was tampered with", () => {
    const payload = buildPromptPayPayload("phone", "0812345678", 90);
    const tampered = `${payload.slice(0, -4)}0000`;

    expect(isValidPromptPayPayload(payload)).toBe(true);
    expect(isValidPromptPayPayload(tampered)).toBe(false);
    expect(isValidPromptPayPayload("63040")).toBe(false);
  });
});

describe("invoice document", () => {
  it("derives one row per meter, charge and amount with the invoice number and dates", () => {
    expect(buildInvoiceRows(meteredBill)).toEqual([
      { group: "ค่าที่พัก", label: "ค่าเช่าห้อง", detail: "รายเดือน", quantity: 1, unitPrice: 3800, amount: 3800 },
      { group: "ค่าสาธารณูปโภค", label: "ค่าน้ำ", detail: "มิเตอร์ 100 → 105", quantity: 5, unitPrice: 18, amount: 90 },
      { group: "ค่าสาธารณูปโภค", label: "ค่าไฟ", detail: "มิเตอร์ 240 → 301", quantity: 61, unitPrice: 6, amount: 366 },
      { group: "ค่าใช้จ่ายเพิ่มเติม", label: "ค่าจัดเก็บขยะ", detail: "ค่าประจำของหอ", quantity: 1, unitPrice: 30, amount: 30 },
      { group: "ค่าใช้จ่ายเพิ่มเติม", label: "ค่า WiFi", detail: "ค่าประจำของหอ", quantity: 1, unitPrice: 100, amount: 100 },
    ]);

    const document = buildInvoiceDocument(meteredBill);
    expect(document.number).toBe("B2569-09-A101");
    expect(document.issueDate).toBe("15 ก.ย. 2569");
    expect(document.periodLabel).toBe("กันยายน 2569");
    expect(document.roomNumber).toBe("A101");
    expect(document.tenantName).toBe("พิชญ์สินี ยีปา");
    expect(document.waterMeter).toBe("100 → 105");
    expect(document.electricMeter).toBe("240 → 301");
    expect(document.total).toBe(4386);
    expect(document.rows.reduce((sum, row) => sum + row.amount, 0)).toBe(4386);
    expect(document.rows.some((row) => row.label === "ค่า WiFi")).toBe(true);
  });

  it("labels a flat electric bill with its monthly amount instead of units", () => {
    const rows = buildInvoiceRows(flatBill);

    expect(rows).toEqual([
      { group: "ค่าที่พัก", label: "ค่าเช่าห้อง", detail: "รายเดือน", quantity: 1, unitPrice: 3900, amount: 3900 },
      { group: "ค่าสาธารณูปโภค", label: "ค่าน้ำ", detail: "มิเตอร์ 20 → 24", quantity: 4, unitPrice: 18, amount: 72 },
      { group: "ค่าสาธารณูปโภค", label: "ค่าไฟ", detail: "เหมาจ่ายรายเดือน", quantity: 1, unitPrice: 600, amount: 600 },
    ]);

    const document = buildInvoiceDocument(flatBill);
    expect(document.number).toBe("B2569-09-A109");
    expect(document.issueDate).toBe("16 ก.ย. 2569");
    expect(document.total).toBe(4572);
    expect(document.rows.reduce((sum, row) => sum + row.amount, 0)).toBe(4572);
  });
});

describe("GET /qr/:billId.png", () => {
  it("serves the bill's promptpay QR as a PNG", async () => {
    await putIssuer();
    const room = await occupiedRoom("C101", { waterMeterInit: 10, electricMeterInit: 20 });
    const bill = await generatedBill(room.id, { waterCurrent: 18, electricCurrent: 40 });

    const response = await SELF.fetch(qrUrl(bill.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(startsWith(bytes, pngSignature)).toBe(true);
    expect(chunkTypeAt(bytes, 8)).toBe("IHDR");
    expect(readUint32(bytes, 8 + 8)).toBe(readUint32(bytes, 8 + 12));
    expect(readUint32(bytes, 8 + 8)).toBeGreaterThan(100);
    expect(chunkTypeAt(bytes, bytes.length - 12)).toBe("IEND");
    expect(bytes.length).toBeGreaterThan(200);
  });

  it("follows the bill's total after the readings change", async () => {
    await putIssuer();
    const room = await occupiedRoom("C102", { waterMeterInit: 10, electricMeterInit: 20 });
    const bill = await generatedBill(room.id, { waterCurrent: 12, electricCurrent: 24 });

    const before = new Uint8Array(await (await SELF.fetch(qrUrl(bill.id))).arrayBuffer());
    const patched = await patchBill(bill.id, { waterCurrent: 60, electricCurrent: 90 });
    expect(patched.status).toBe(200);
    expect((await patched.json<{ ok: boolean; bill: BillPayload }>()).bill.total).toBeGreaterThan(bill.total);

    const response = await SELF.fetch(qrUrl(bill.id));
    expect(response.status).toBe(200);

    const after = new Uint8Array(await response.arrayBuffer());
    expect(startsWith(after, pngSignature)).toBe(true);
    expect(chunkTypeAt(after, 8)).toBe("IHDR");
    expect(Array.from(after)).not.toEqual(Array.from(before));

    const steady = new Uint8Array(await (await SELF.fetch(qrUrl(bill.id))).arrayBuffer());
    expect(Array.from(steady)).toEqual(Array.from(after));
  });

  it("answers a json 404 for an unknown bill and a wrong extension", async () => {
    await putIssuer();

    const missing = await SELF.fetch(qrUrl("bill-does-not-exist"));
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("application/json");

    const body = await missing.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");

    const wrongExtension = await SELF.fetch("https://dorm.test/qr/bill.png.jpg");
    expect(wrongExtension.status).toBe(404);
    expect((await wrongExtension.json<ErrorBody>()).error.code).toBe("NOT_FOUND");
  });
});

describe("GET /invoices/:billId.pdf", () => {
  it("serves the invoice as a PDF built from the bill row", async () => {
    await putIssuer();
    const room = await occupiedRoom("C201", { rent: 3800, waterMeterInit: 100, electricMeterInit: 240 });
    const bill = await generatedBill(room.id, { waterCurrent: 105, electricCurrent: 301 });

    const response = await SELF.fetch(invoiceUrl(bill.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toContain(".pdf");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])).toBe(true);
    expect(bytes.length).toBeGreaterThan(5000);
    expect(bytes.length).toBeLessThan(300000);

    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.endsWith("%%EOF\n") || text.includes("%%EOF")).toBe(true);
  });

  it("adds a table row for every extra charge", async () => {
    await putIssuer();
    const plain = await occupiedRoom("C202", { rent: 3800, waterMeterInit: 100, electricMeterInit: 240 });
    const plainBill = await generatedBill(plain.id, { waterCurrent: 105, electricCurrent: 301 });

    const charged = await occupiedRoom("C203", { rent: 3800, waterMeterInit: 100, electricMeterInit: 240 });
    const chargedBill = await generatedBill(charged.id, {
      waterCurrent: 105,
      electricCurrent: 301,
      charges: [
        { name: "ค่าอินเทอร์เน็ต", amount: 200 },
        { name: "ค่าจัดเก็บขยะ", amount: 40 },
        { name: "ค่าที่จอดรถ", amount: 300 },
      ],
    });

    expect(chargedBill.charges).toHaveLength(3);

    const plainPdf = new Uint8Array(await (await SELF.fetch(invoiceUrl(plainBill.id))).arrayBuffer());
    const chargedPdf = new Uint8Array(await (await SELF.fetch(invoiceUrl(chargedBill.id))).arrayBuffer());

    expect(startsWith(chargedPdf, [0x25, 0x50, 0x44, 0x46, 0x2d])).toBe(true);
    expect(chargedPdf.length).toBeGreaterThan(plainPdf.length);
  });

  it("embeds the bill's promptpay QR image in the invoice, unaffected by a later settings change", async () => {
    await putIssuer();
    const room = await occupiedRoom("C204", { rent: 3800, waterMeterInit: 100, electricMeterInit: 240 });
    const bill = await generatedBill(room.id, { waterCurrent: 105, electricCurrent: 301 });

    const withQr = new Uint8Array(await (await SELF.fetch(invoiceUrl(bill.id))).arrayBuffer());
    const withQrText = new TextDecoder("latin1").decode(withQr);
    expect(withQrText).toContain("/Subtype /Image");

    // เจ้าของหอเปลี่ยนพร้อมเพย์ในตั้งค่าหลังบิลใบนี้ออกไปแล้ว
    await env.DB.prepare(
      "UPDATE settings SET value = '0899991234' WHERE family_id = ? AND key = 'promptpay_id'",
    )
      .bind(session.familyId)
      .run();

    // บิลที่ออกไปแล้วต้องยังมี QR อยู่ เพราะผู้รับเงินถูก snapshot ไว้ในบิลแล้ว
    // ไม่ได้อ่านตั้งค่าปัจจุบันสด ๆ ตอนสร้างเอกสาร (ดู migration 0011)
    const afterChange = new Uint8Array(await (await SELF.fetch(invoiceUrl(bill.id))).arrayBuffer());
    expect(new TextDecoder("latin1").decode(afterChange)).toContain("/Subtype /Image");

    await putIssuer();
  });

  it("answers 404 for an unknown bill and a wrong extension", async () => {
    await putIssuer();

    const missing = await SELF.fetch(invoiceUrl("bill-does-not-exist"));
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toContain("application/json");

    const body = await missing.json<ErrorBody>();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");

    const wrongExtension = await SELF.fetch("https://dorm.test/invoices/bill.pdf.png");
    expect(wrongExtension.status).toBe(404);
    expect((await wrongExtension.json<ErrorBody>()).error.code).toBe("NOT_FOUND");
  });

  it("keeps the invoice number of an issued bill after the room is renamed", async () => {
    await putIssuer();
    const room = await occupiedRoom("D301", { rent: 3800, waterMeterInit: 100, electricMeterInit: 240 });
    const bill = await generatedBill(room.id, { waterCurrent: 105, electricCurrent: 301 });

    const before = await SELF.fetch(invoiceUrl(bill.id));
    expect(before.status).toBe(200);
    expect(before.headers.get("content-disposition")).toContain("B2569-09-D301.pdf");

    await env.DB.prepare("UPDATE rooms SET room_number = ? WHERE family_id = ? AND id = ?")
      .bind("D302", session.familyId, room.id)
      .run();

    const after = await SELF.fetch(invoiceUrl(bill.id));
    expect(after.status).toBe(200);

    const disposition = after.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("B2569-09-D301.pdf");
    expect(disposition).not.toContain("D302");

    // บิลใหม่ของเดือนถัดไปยังใช้เลขห้องล่าสุดตามปกติ
    const next = await generatedBill(room.id, { waterCurrent: 110, electricCurrent: 320 }, "2026-10");
    const nextInvoice = await SELF.fetch(invoiceUrl(next.id));
    expect(nextInvoice.headers.get("content-disposition")).toContain("B2569-10-D302.pdf");
  });
});

describe("promptpay settings per family", () => {
  it("snapshots each family's own payee onto its own bills, never another family's", async () => {
    await putIssuer();
    const ownRoom = await occupiedRoom("D401", { waterMeterInit: 10, electricMeterInit: 20 });
    const ownBill = await generatedBill(ownRoom.id, { waterCurrent: 18, electricCurrent: 40 });

    const ownQr = await SELF.fetch(qrUrl(ownBill.id));
    expect(ownQr.status).toBe(200);

    const otherFamily = await createFamily("หอของอีกครอบครัว");
    const other = await signIn("owner", otherFamily);

    // ครอบครัวที่สองมีบัญชีธนาคารครบคู่ (ชื่อธนาคาร + เลขบัญชี ผ่านเงื่อนไข
    // "ต้องมีช่องทางรับเงินอย่างน้อยหนึ่งอย่างก่อนออกบิลได้") แต่ยังไม่มีพร้อมเพย์เลย
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO settings (family_id, key, value, updated_at) VALUES (?, 'bank_name', ?, datetime('now'))",
      ).bind(otherFamily, "kbank"),
      env.DB.prepare(
        "INSERT INTO settings (family_id, key, value, updated_at) VALUES (?, 'bank_account_number', ?, datetime('now'))",
      ).bind(otherFamily, "1234567890"),
    ]);

    const otherRoom = await occupiedRoomFor(other, "E101");
    const otherBill = await generatedBillFor(other, otherRoom.id);

    // บิลใบนี้ snapshot ไว้ว่าไม่มีพร้อมเพย์ จึงสร้าง QR พร้อมเพย์ไม่ได้ และต้องไม่ยืม
    // ค่าพร้อมเพย์ของครอบครัวแรกมาใช้
    const otherQr = await SELF.fetch(qrUrl(otherBill.id));
    expect(otherQr.status).toBe(500);
    expect((await otherQr.json<ErrorBody>()).error.code).toBe("INTERNAL");

    const otherInvoice = new Uint8Array(await (await SELF.fetch(invoiceUrl(otherBill.id))).arrayBuffer());
    expect(new TextDecoder("latin1").decode(otherInvoice)).not.toContain("/Subtype /Image");

    // ตั้งพร้อมเพย์เพิ่มทีหลัง — บิลเก่าที่ออกไปแล้วต้อง "ไม่" เปลี่ยนตาม (snapshot ไว้แล้ว)
    await env.DB.prepare(
      "INSERT INTO settings (family_id, key, value, updated_at) VALUES (?, 'promptpay_id', ?, datetime('now')) ON CONFLICT(family_id, key) DO UPDATE SET value = excluded.value",
    )
      .bind(otherFamily, "0899991234")
      .run();

    const staleQr = await SELF.fetch(qrUrl(otherBill.id));
    expect(staleQr.status).toBe(500);

    const staleInvoice = new Uint8Array(await (await SELF.fetch(invoiceUrl(otherBill.id))).arrayBuffer());
    expect(new TextDecoder("latin1").decode(staleInvoice)).not.toContain("/Subtype /Image");

    // บิลใหม่ที่ออกหลังตั้งพร้อมเพย์แล้วต้อง snapshot พร้อมเพย์ตัวใหม่ของตัวเอง
    const newBill = await generatedBillFor(other, otherRoom.id, "2026-10");
    const newQr = await SELF.fetch(qrUrl(newBill.id));
    expect(newQr.status).toBe(200);
    expect(newQr.headers.get("content-type")).toBe("image/png");

    const newInvoice = new Uint8Array(await (await SELF.fetch(invoiceUrl(newBill.id))).arrayBuffer());
    expect(new TextDecoder("latin1").decode(newInvoice)).toContain("/Subtype /Image");
  });
});
