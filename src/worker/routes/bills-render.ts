import { Hono } from "hono";
import { buildInvoiceDocument, type InvoiceBill } from "../lib/invoice";
import { renderInvoicePdf } from "../lib/pdf";
import { buildPromptPayPayload, type PromptPayIdType } from "../lib/promptpay";
import { encodeQrPng } from "../lib/qr";
import { errorBody } from "./shared";

const billColumns =
  "r.room_number, t.full_name AS tenant_name, b.period, b.rent, b.water_previous, b.water_current, b.water_units, b.water_rate, b.water_amount, b.electric_mode, b.electric_previous, b.electric_current, b.electric_units, b.electric_rate, b.electric_amount, b.total, b.created_at";

const billFrom = "FROM bills b JOIN rooms r ON r.id = b.room_id JOIN tenants t ON t.id = b.tenant_id";

const issuerKeys = ["dorm_name", "owner_name", "promptpay_id", "promptpay_type", "promptpay_name"];

interface BillRow {
  room_number: string;
  tenant_name: string;
  period: string;
  rent: number;
  water_previous: number;
  water_current: number;
  water_units: number;
  water_rate: number;
  water_amount: number;
  electric_mode: string;
  electric_previous: number;
  electric_current: number;
  electric_units: number | null;
  electric_rate: number | null;
  electric_amount: number;
  total: number;
  created_at: string;
}

interface ChargeRow {
  name: string;
  amount: number;
}

interface Issuer {
  dormName: string;
  ownerName: string;
  promptpayId: string;
  promptpayType: PromptPayIdType;
  promptpayName: string;
}

export const qrRoute = new Hono<{ Bindings: Env }>();
export const invoiceRoute = new Hono<{ Bindings: Env }>();

function fileId(file: string, extension: string): string | null {
  if (!file.endsWith(extension)) {
    return null;
  }

  const id = file.slice(0, -extension.length);
  return id === "" ? null : id;
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

async function loadInvoiceBill(env: Env, id: string): Promise<InvoiceBill | null> {
  const row = await env.DB.prepare(`SELECT ${billColumns} ${billFrom} WHERE b.id = ?`).bind(id).first<BillRow>();

  if (row === null) {
    return null;
  }

  const charges = await env.DB.prepare("SELECT name, amount FROM bill_charges WHERE bill_id = ? ORDER BY position ASC")
    .bind(id)
    .all<ChargeRow>();

  return {
    roomNumber: row.room_number,
    tenantName: row.tenant_name,
    period: row.period,
    rent: row.rent,
    waterPrevious: row.water_previous,
    waterCurrent: row.water_current,
    waterUnits: row.water_units,
    waterRate: row.water_rate,
    waterAmount: row.water_amount,
    electricMode: row.electric_mode === "flat" ? "flat" : "meter",
    electricPrevious: row.electric_previous,
    electricCurrent: row.electric_current,
    electricUnits: row.electric_units,
    electricRate: row.electric_rate,
    electricAmount: row.electric_amount,
    charges: charges.results,
    total: row.total,
    createdAt: row.created_at,
  };
}

async function loadIssuer(env: Env): Promise<Issuer> {
  const placeholders = issuerKeys.map(() => "?").join(", ");
  const result = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .bind(...issuerKeys)
    .all<{ key: string; value: string }>();
  const stored = new Map(result.results.map((row) => [row.key, row.value]));

  return {
    dormName: stored.get("dorm_name") ?? "",
    ownerName: stored.get("owner_name") ?? "",
    promptpayId: stored.get("promptpay_id") ?? "",
    promptpayType: stored.get("promptpay_type") === "citizen-id" ? "citizen-id" : "phone",
    promptpayName: stored.get("promptpay_name") ?? "",
  };
}

async function buildPromptPayQr(issuer: Issuer, total: number): Promise<Uint8Array<ArrayBuffer>> {
  return encodeQrPng(buildPromptPayPayload(issuer.promptpayType, issuer.promptpayId, total));
}

qrRoute.get("/:file", async (c) => {
  const billId = fileId(c.req.param("file"), ".png");

  if (billId === null) {
    return c.json(errorBody("NOT_FOUND", "ไม่พบรูป QR พร้อมเพย์ที่ต้องการ"), 404);
  }

  try {
    const bill = await loadInvoiceBill(c.env, billId);

    if (bill === null) {
      return c.json(errorBody("NOT_FOUND", "ไม่พบบิลของรูป QR พร้อมเพย์นี้"), 404);
    }

    const issuer = await loadIssuer(c.env);

    if (issuer.promptpayId === "") {
      console.error(JSON.stringify({ message: "promptpay qr failed", billId, reason: "promptpay id is not configured" }));
      return c.json(errorBody("INTERNAL", "ยังไม่ได้ตั้งค่าพร้อมเพย์ไอดี"), 500);
    }

    const png = await buildPromptPayQr(issuer, bill.total);

    return c.body(png, 200, {
      "content-type": "image/png",
      "cache-control": "public, max-age=60",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "render promptpay qr failed", billId, error: detail }));
    return c.json(errorBody("INTERNAL", "สร้างรูป QR พร้อมเพย์ไม่สำเร็จ"), 500);
  }
});

invoiceRoute.get("/:file", async (c) => {
  const billId = fileId(c.req.param("file"), ".pdf");

  if (billId === null) {
    return c.json(errorBody("NOT_FOUND", "ไม่พบใบแจ้งหนี้ที่ต้องการ"), 404);
  }

  try {
    const bill = await loadInvoiceBill(c.env, billId);

    if (bill === null) {
      return c.json(errorBody("NOT_FOUND", "ไม่พบใบแจ้งหนี้ของบิลนี้"), 404);
    }

    const issuer = await loadIssuer(c.env);
    const document = buildInvoiceDocument(bill);
    const qrPng = issuer.promptpayId === "" ? undefined : await buildPromptPayQr(issuer, bill.total);
    const pdf = await renderInvoicePdf(document, issuer, qrPng);

    return c.body(pdf, 200, {
      "content-type": "application/pdf",
      "cache-control": "no-store",
      "content-disposition": `inline; filename="${safeFileName(document.number)}.pdf"`,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: "render invoice pdf failed", billId, error: detail }));
    return c.json(errorBody("INTERNAL", "สร้างใบแจ้งหนี้ไม่สำเร็จ"), 500);
  }
});
