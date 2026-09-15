import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import boldFontData from "../fonts/IBMPlexSansThai-Bold.ttf";
import regularFontData from "../fonts/IBMPlexSansThai-Regular.ttf";
import { formatBaht, type InvoiceDocument } from "./invoice";

export interface InvoiceIssuer {
  dormName: string;
  ownerName: string;
  promptpayId: string;
  promptpayName: string;
}

const pageWidth = 595.28;
const pageHeight = 841.89;
const margin = 48;
const footerY = 40;
const contentRight = pageWidth - margin;
const labelX = margin + 10;
const detailX = margin + 170;
const amountRight = contentRight - 10;
const rowHeight = 22;
const tableHeaderHeight = 24;
const qrSize = 128;
const qrBottom = 96;
const qrRuleGap = 22;

const ink = rgb(0.09, 0.09, 0.09);
const muted = rgb(0.42, 0.45, 0.5);
const rule = rgb(0.85, 0.87, 0.9);
const headerFill = rgb(0.93, 0.95, 0.98);
const totalInk = rgb(0.72, 0.11, 0.11);

function clip(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) {
    return text;
  }

  let clipped = text;

  while (clipped.length > 1 && font.widthOfTextAtSize(`${clipped}…`, size) > maxWidth) {
    clipped = clipped.slice(0, -1);
  }

  return `${clipped}…`;
}

function rightAligned(page: PDFPage, text: string, font: PDFFont, size: number, y: number, color = ink): void {
  page.drawText(text, { x: amountRight - font.widthOfTextAtSize(text, size), y, size, font, color });
}

function ruleLine(page: PDFPage, y: number, thickness = 1, color = rule): void {
  page.drawLine({ start: { x: margin, y }, end: { x: contentRight, y }, thickness, color });
}

function tableHeader(page: PDFPage, top: number, bold: PDFFont): void {
  page.drawRectangle({ x: margin, y: top - tableHeaderHeight, width: contentRight - margin, height: tableHeaderHeight, color: headerFill });
  page.drawText("รายการ", { x: labelX, y: top - 16, size: 10, font: bold, color: ink });
  page.drawText("รายละเอียด", { x: detailX, y: top - 16, size: 10, font: bold, color: muted });
  rightAligned(page, "จำนวนเงิน (บาท)", bold, 10, top - 16, muted);
  ruleLine(page, top - tableHeaderHeight);
}

function itemRow(page: PDFPage, label: string, detail: string, amount: number, y: number, regular: PDFFont): void {
  page.drawText(clip(label, regular, 11, detailX - labelX - 12), { x: labelX, y: y - 15, size: 11, font: regular, color: ink });
  page.drawText(clip(detail, regular, 9, amountRight - detailX - 90), { x: detailX, y: y - 15, size: 9, font: regular, color: muted });
  rightAligned(page, formatBaht(amount), regular, 11, y - 15);
  ruleLine(page, y - rowHeight + 1);
}

export async function renderInvoicePdf(
  document: InvoiceDocument,
  issuer: InvoiceIssuer,
  qrPng?: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const regular = await pdf.embedFont(regularFontData, { subset: true, features: { ccmp: false } });
  const bold = await pdf.embedFont(boldFontData, { subset: true, features: { ccmp: false } });
  let page = pdf.addPage([pageWidth, pageHeight]);

  pdf.setTitle(`ใบแจ้งหนี้ ${document.number}`);
  pdf.setCreator("Wang Chan Dorm");
  pdf.setProducer("Wang Chan Dorm");

  let y = pageHeight - margin;

  page.drawText("ใบแจ้งหนี้ / INVOICE", { x: margin, y: y - 20, size: 20, font: bold, color: ink });
  rightAligned(page, `เลขที่ ${document.number}`, regular, 11, y - 8);
  rightAligned(page, `วันที่ออก ${document.issueDate}`, regular, 10, y - 25, muted);
  y -= 46;

  if (issuer.dormName !== "") {
    page.drawText(clip(issuer.dormName, bold, 13, 300), { x: margin, y, size: 13, font: bold, color: ink });
    y -= 17;
  }

  if (issuer.ownerName !== "") {
    page.drawText(clip(`เจ้าของหอ: ${issuer.ownerName}`, regular, 10, 340), { x: margin, y, size: 10, font: regular, color: muted });
    y -= 15;
  }

  if (issuer.promptpayId !== "") {
    const account = issuer.promptpayName === "" ? "" : ` (${issuer.promptpayName})`;
    page.drawText(clip(`พร้อมเพย์: ${issuer.promptpayId}${account}`, regular, 10, 340), { x: margin, y, size: 10, font: regular, color: muted });
    y -= 15;
  }

  y -= 4;
  ruleLine(page, y);
  y -= 20;

  const boxTop = y;
  const boxHeight = 62;

  page.drawRectangle({
    x: margin,
    y: boxTop - boxHeight,
    width: contentRight - margin,
    height: boxHeight,
    borderColor: rule,
    borderWidth: 1,
    color: rgb(1, 1, 1),
  });
  page.drawText(clip(`ห้อง ${document.roomNumber} · ผู้เช่า ${document.tenantName}`, regular, 11, 300), {
    x: margin + 12,
    y: boxTop - 22,
    size: 11,
    font: regular,
    color: ink,
  });
  page.drawText(clip(`มิเตอร์น้ำ ${document.waterMeter} · มิเตอร์ไฟ ${document.electricMeter}`, regular, 9, 320), {
    x: margin + 12,
    y: boxTop - 42,
    size: 9,
    font: regular,
    color: muted,
  });
  const periodText = `ประจำเดือน ${document.periodLabel}`;
  page.drawText(periodText, {
    x: contentRight - 12 - bold.widthOfTextAtSize(periodText, 11),
    y: boxTop - 22,
    size: 11,
    font: bold,
    color: ink,
  });

  y = boxTop - boxHeight - 28;
  tableHeader(page, y, bold);
  y -= tableHeaderHeight;

  for (const row of document.rows) {
    if (y - rowHeight < margin + 60) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
      tableHeader(page, y, bold);
      y -= tableHeaderHeight;
    }

    itemRow(page, row.label, row.detail, row.amount, y, regular);
    y -= rowHeight;
  }

  y -= 10;
  ruleLine(page, y, 2, rgb(0.55, 0.58, 0.62));
  y -= 10;
  page.drawText("ยอดรวมทั้งสิ้น", { x: labelX, y: y - 14, size: 13, font: bold, color: ink });
  rightAligned(page, `${formatBaht(document.total)} บาท`, bold, 13, y - 14, totalInk);

  if (qrPng !== undefined) {
    const blockTop = qrBottom + qrSize;

    if (y - 30 < blockTop + qrRuleGap) {
      page = pdf.addPage([pageWidth, pageHeight]);
    }

    const image = await pdf.embedPng(qrPng);
    ruleLine(page, blockTop + qrRuleGap);
    page.drawImage(image, { x: margin, y: qrBottom, width: qrSize, height: qrSize });

    const noteX = margin + qrSize + 22;
    const noteWidth = contentRight - noteX;
    page.drawText("ชำระเงินผ่านพร้อมเพย์", { x: noteX, y: blockTop - 10, size: 12, font: bold, color: ink });
    page.drawText(clip("สแกนจ่ายยอดนี้ด้วยแอปธนาคาร", regular, 10, noteWidth), { x: noteX, y: blockTop - 34, size: 10, font: regular, color: muted });
    page.drawText(clip("ส่งสลิปกลับในแชท LINE ของหอได้เลย", regular, 10, noteWidth), { x: noteX, y: blockTop - 50, size: 10, font: regular, color: muted });
  }

  page.drawText("ขอบคุณที่ใช้บริการ", { x: margin, y: footerY, size: 10, font: regular, color: muted });

  return new Uint8Array(await pdf.save());
}
