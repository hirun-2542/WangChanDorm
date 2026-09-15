import { buildInvoiceRows, formatBaht, thaiDateLabel, thaiPeriodLabel, type InvoiceRow } from "../lib/invoice";

export interface BillMessageCharge {
  name: string;
  amount: number;
}

export interface BillMessageBill {
  id: string;
  roomNumber: string;
  tenantName: string;
  period: string;
  rent: number;
  waterUnits: number;
  waterRate: number;
  waterAmount: number;
  electricMode: "meter" | "flat";
  electricUnits: number | null;
  electricRate: number | null;
  electricAmount: number;
  charges: BillMessageCharge[];
  total: number;
  createdAt: string;
}

export interface BillMessageIssuer {
  promptpayName: string;
}

export type FlexContent = Record<string, unknown>;

export type BillFlexMessage = {
  type: "flex";
  altText: string;
  contents: FlexContent;
};

function amountRow(row: InvoiceRow): FlexContent {
  const contents: FlexContent[] = [
    {
      type: "box",
      layout: "horizontal",
      contents: [
        { type: "text", text: row.label, size: "sm", color: "#3f3f46", flex: 1, wrap: true },
        { type: "text", text: `${formatBaht(row.amount)} บาท`, size: "sm", color: "#27272a", align: "end", flex: 0 },
      ],
    },
  ];

  if (row.detail !== "") {
    contents.push({ type: "text", text: row.detail, size: "xs", color: "#a1a1aa", wrap: true });
  }

  return { type: "box", layout: "vertical", spacing: "xs", contents };
}

function issuedRow(createdAt: string): FlexContent {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: "ออกบิลเมื่อ", size: "xs", color: "#71717a", flex: 1 },
      { type: "text", text: thaiDateLabel(createdAt), size: "xs", color: "#71717a", align: "end" },
    ],
  };
}

function totalRow(total: number): FlexContent {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: "ยอดรวมทั้งสิ้น", size: "sm", weight: "bold", color: "#27272a", flex: 1 },
      { type: "text", text: `${formatBaht(total)} บาท`, size: "lg", weight: "bold", color: "#dc2626", align: "end" },
    ],
  };
}

export function buildBillFlexMessage(bill: BillMessageBill, issuer: BillMessageIssuer, baseUrl: string): BillFlexMessage {
  const origin = baseUrl.replace(/\/+$/, "");
  const periodLabel = thaiPeriodLabel(bill.period);
  const qrUrl = `${origin}/qr/${encodeURIComponent(bill.id)}.png`;
  const pdfUrl = `${origin}/invoices/${encodeURIComponent(bill.id)}.pdf`;
  const totalLabel = `${formatBaht(bill.total)} บาท`;
  const payer = issuer.promptpayName.trim();
  const slipLine = payer === "" ? "โอนเงินแล้วส่งสลิปกลับในแชทนี้" : `โอนเข้าพร้อมเพย์ ${payer} แล้วส่งสลิปกลับในแชทนี้`;

  const header: FlexContent = {
    type: "box",
    layout: "vertical",
    backgroundColor: "#2563eb",
    paddingAll: "16px",
    spacing: "xs",
    contents: [
      { type: "text", text: "ใบแจ้งหนี้ / INVOICE", size: "lg", weight: "bold", color: "#ffffff", wrap: true },
      { type: "text", text: `ห้อง ${bill.roomNumber} | ประจำเดือน ${periodLabel}`, size: "sm", color: "#ffffff", wrap: true },
    ],
  };

  const body: FlexContent = {
    type: "box",
    layout: "vertical",
    spacing: "md",
    paddingAll: "16px",
    contents: [
      { type: "text", text: `ผู้เช่า ${bill.tenantName}`, size: "sm", color: "#52525b", wrap: true },
      issuedRow(bill.createdAt),
      ...buildInvoiceRows(bill).map(amountRow),
      { type: "separator", margin: "lg" },
      totalRow(bill.total),
    ],
  };

  const footer: FlexContent = {
    type: "box",
    layout: "vertical",
    spacing: "md",
    paddingAll: "16px",
    contents: [
      { type: "image", url: qrUrl, size: "lg", aspectRatio: "1:1", aspectMode: "fit", align: "center" },
      { type: "button", style: "primary", color: "#2563eb", action: { type: "uri", label: "เปิดใบแจ้งหนี้ PDF", uri: pdfUrl } },
      { type: "text", text: slipLine, size: "xs", color: "#a1a1aa", align: "center", wrap: true },
    ],
  };

  return {
    type: "flex",
    altText: `ใบแจ้งหนี้ห้อง ${bill.roomNumber} ประจำเดือน ${periodLabel} ยอด ${totalLabel}`,
    contents: { type: "bubble", header, body, footer },
  };
}
