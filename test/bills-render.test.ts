import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { buildInvoiceDocument, buildInvoiceRows, type InvoiceBill } from "../src/worker/lib/invoice";
import {
  buildPromptPayPayload,
  crc16CcittFalse,
  crc16CcittFalseHex,
  isValidPromptPayPayload,
  promptPayMerchantTarget,
  promptPayPayloadChecksum,
} from "../src/worker/lib/promptpay";

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

function post(url: string, payload: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(url, {
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
  const response = await SELF.fetch(settingsUrl, {
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

async function generatedBill(roomId: string, entry: Record<string, unknown>): Promise<BillPayload> {
  const response = await post(`${billsUrl}/generate`, { period: "2026-09", entries: [{ roomId, ...entry }] });
  expect(response.status).toBe(201);
  return first((await response.json<{ ok: boolean; bills: BillPayload[] }>()).bills);
}

function patchBill(id: string, payload: Record<string, unknown>): Promise<Response> {
  return SELF.fetch(`${billsUrl}/${id}`, {
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
      { label: "ค่าเช่าห้อง", detail: "รายเดือน", amount: 3800 },
      { label: "ค่าน้ำ", detail: "5 หน่วย × 18 บาท/หน่วย", amount: 90 },
      { label: "ค่าไฟ", detail: "61 หน่วย × 6 บาท/หน่วย", amount: 366 },
      { label: "ค่าจัดเก็บขยะ", detail: "ค่าใช้จ่ายเพิ่มเติม", amount: 30 },
      { label: "ค่า WiFi", detail: "ค่าใช้จ่ายเพิ่มเติม", amount: 100 },
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
      { label: "ค่าเช่าห้อง", detail: "รายเดือน", amount: 3900 },
      { label: "ค่าน้ำ", detail: "4 หน่วย × 18 บาท/หน่วย", amount: 72 },
      { label: "ค่าไฟ", detail: "เหมาจ่าย 600 บาท", amount: 600 },
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
    expect(response.headers.get("cache-control")).toContain("max-age");

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

  it("embeds the bill's promptpay QR image in the invoice", async () => {
    await putIssuer();
    const room = await occupiedRoom("C204", { rent: 3800, waterMeterInit: 100, electricMeterInit: 240 });
    const bill = await generatedBill(room.id, { waterCurrent: 105, electricCurrent: 301 });

    const withQr = new Uint8Array(await (await SELF.fetch(invoiceUrl(bill.id))).arrayBuffer());
    const withQrText = new TextDecoder("latin1").decode(withQr);
    expect(withQrText).toContain("/Subtype /Image");

    await env.DB.prepare("UPDATE settings SET value = '' WHERE key = 'promptpay_id'").run();

    const withoutQr = new Uint8Array(await (await SELF.fetch(invoiceUrl(bill.id))).arrayBuffer());
    const withoutQrText = new TextDecoder("latin1").decode(withoutQr);
    expect(withoutQrText).not.toContain("/Subtype /Image");
    expect(withQr.length).toBeGreaterThan(withoutQr.length);

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
});
