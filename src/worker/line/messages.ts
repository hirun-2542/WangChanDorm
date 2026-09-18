import type { FlexContent } from "./bill-message";
import { formatBaht, thaiPeriodLabel } from "../lib/invoice";

export type LineFlexMessage = { type: "flex"; altText: string; contents: FlexContent };

type Tone = "success" | "info" | "warning" | "danger";

interface TonePalette {
  background: string;
  title: string;
}

interface CardRow {
  label: string;
  value: string;
  bold?: boolean;
}

const tonePalettes: Record<Tone, TonePalette> = {
  success: { background: "#ECFDF5", title: "#047857" },
  info: { background: "#EFF6FF", title: "#1D4ED8" },
  warning: { background: "#FFFBEB", title: "#B45309" },
  danger: { background: "#FEF2F2", title: "#B91C1C" },
};

function separator(): FlexContent {
  return { type: "separator", color: "#E5E5E5" };
}

function header(tone: Tone, title: string): FlexContent {
  const palette = tonePalettes[tone];

  return {
    type: "box",
    layout: "vertical",
    backgroundColor: palette.background,
    paddingAll: "16px",
    contents: [{ type: "text", text: title, size: "lg", weight: "bold", color: palette.title, wrap: true }],
  };
}

function row(item: CardRow): FlexContent {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "md",
    contents: [
      { type: "text", text: item.label, size: "sm", color: "#525252", flex: 3, wrap: true },
      {
        type: "text",
        text: item.value,
        size: "sm",
        weight: item.bold === true ? "bold" : "regular",
        color: "#171717",
        align: "end",
        flex: 5,
        wrap: true,
      },
    ],
  };
}

function rows(list: readonly CardRow[]): FlexContent[] {
  const contents: FlexContent[] = [];

  list.forEach((item, index) => {
    if (index > 0) {
      contents.push(separator());
    }

    contents.push(row(item));
  });

  return contents;
}

function note(text: string): FlexContent {
  return { type: "text", text, size: "sm", color: "#525252", wrap: true };
}

function footerButton(label: string, uri: string): FlexContent {
  return {
    type: "box",
    layout: "vertical",
    paddingAll: "16px",
    contents: [{ type: "button", style: "primary", color: "#2563eb", action: { type: "uri", label, uri } }],
  };
}

function card(tone: Tone, title: string, altText: string, body: FlexContent[], footer?: FlexContent): LineFlexMessage {
  const contents: FlexContent = {
    type: "bubble",
    size: "mega",
    header: header(tone, title),
    body: { type: "box", layout: "vertical", spacing: "md", paddingAll: "16px", contents: body },
  };

  if (footer !== undefined) {
    contents.footer = footer;
  }

  return { type: "flex", altText, contents };
}

function bahtText(value: number): string {
  const rounded = Math.round(value * 100) / 100;

  return Number.isInteger(rounded)
    ? formatBaht(rounded)
    : rounded.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function welcomeMessage(dormName: string): LineFlexMessage {
  return card("info", "ยินดีต้อนรับ", `ยินดีต้อนรับสู่${dormName} พิมพ์เลขห้องเพื่อเชื่อม LINE`, [
    note(`ยินดีต้อนรับสู่${dormName}`),
    note("พิมพ์เลขห้องของคุณ เช่น A101 เพื่อเชื่อม LINE"),
  ]);
}

export function linkedMessage(fullName: string, roomNumber: string): LineFlexMessage {
  return card("success", "เชื่อม LINE สำเร็จ", `เชื่อม LINE กับคุณ${fullName} ห้อง ${roomNumber} สำเร็จ`, rows([
    { label: "ผู้เช่า", value: fullName },
    { label: "ห้อง", value: roomNumber },
  ]));
}

export function notMatchedMessage(text: string): LineFlexMessage {
  const trimmed = text.trim();

  if (/^[A-Za-z]\d+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
    return card("danger", "ไม่พบห้องนี้", `ไม่พบห้อง ${trimmed} กรุณาตรวจสอบเลขห้องอีกครั้ง`, [
      note(`ไม่พบห้อง ${trimmed} ที่มีผู้เช่าอยู่ในระบบ`),
      note("กรุณาตรวจสอบเลขห้องอีกครั้ง หรือติดต่อเจ้าของหอ"),
    ]);
  }

  return card("info", "ยังไม่พบห้องของคุณ", "พิมพ์เลขห้องเพื่อเชื่อม LINE หรือติดต่อเจ้าของหอ", [
    note("ยังไม่พบห้องของคุณ"),
    note("กรุณาพิมพ์เลขห้อง เช่น A101 เพื่อเชื่อม LINE หรือติดต่อเจ้าของหอ"),
  ]);
}

export function ownerLinkedMessage(): LineFlexMessage {
  return card("success", "เชื่อม LINE เจ้าของสำเร็จ", "เชื่อม LINE เจ้าของเรียบร้อย ระบบจะแจ้งเตือนที่ห้องแชทนี้", [
    note("เชื่อม LINE เจ้าของเรียบร้อย"),
    note("ระบบจะแจ้งเตือนที่ห้องแชทนี้"),
  ]);
}

export function slipNotLinkedMessage(): LineFlexMessage {
  return card("warning", "ยังไม่ได้เชื่อม LINE", "เชื่อม LINE กับห้องก่อนส่งสลิป พิมพ์เลขห้อง เช่น A101", [
    note("กรุณาเชื่อม LINE กับห้องของคุณก่อนส่งสลิป"),
    note("พิมพ์เลขห้อง เช่น A101 เพื่อเชื่อม"),
  ]);
}

export function slipDownloadFailedMessage(): LineFlexMessage {
  return card("danger", "รับสลิปไม่สำเร็จ", "ระบบดาวน์โหลดรูปสลิปไม่สำเร็จ กรุณาส่งรูปสลิปอีกครั้ง", [
    note("ระบบดาวน์โหลดรูปสลิปไม่สำเร็จ"),
    note("กรุณาส่งรูปสลิปอีกครั้ง"),
  ]);
}

export function slipMatchedMessage(amount: number, period: string): LineFlexMessage {
  const periodLabel = thaiPeriodLabel(period);
  const amountLabel = `${bahtText(amount)} บาท`;

  return card(
    "success",
    "ปิดบิลเรียบร้อย",
    `ได้รับชำระบิลประจำเดือน ${periodLabel} ยอด ${amountLabel} เรียบร้อยแล้ว`,
    rows([
      { label: "รอบบิล", value: periodLabel },
      { label: "ยอดชำระ", value: amountLabel, bold: true },
    ]),
  );
}

export function slipPendingReviewMessage(): LineFlexMessage {
  return card("warning", "สลิปรอตรวจสอบ", "ได้รับสลิปแล้ว เจ้าของหอจะตรวจสอบและยืนยันผลการชำระให้อีกครั้ง", [
    note("ได้รับสลิปแล้ว"),
    note("เจ้าของหอจะตรวจสอบและยืนยันผลการชำระให้อีกครั้ง"),
  ]);
}

export function slipDuplicateMessage(): LineFlexMessage {
  return card("danger", "สลิปซ้ำ", "สลิปนี้ถูกใช้ปิดบิลไปแล้ว กรุณาส่งสลิปของรายการใหม่", [
    note("สลิปนี้ถูกใช้ปิดบิลไปแล้ว"),
    note("กรุณาส่งสลิปของรายการใหม่หรือติดต่อเจ้าของหอ"),
  ]);
}

export function ownerSlipPendingMessage(
  roomNumber: string,
  tenantName: string,
  slipAmount: number | null,
  billTotal: number | null,
): LineFlexMessage {
  const amountValue = slipAmount === null ? "อ่านไม่ได้" : `${bahtText(slipAmount)} บาท`;
  const compareValue = billTotal === null ? "ยังไม่มีบิลค้างให้เทียบ" : `${bahtText(billTotal)} บาท`;

  return card("warning", "มีสลิปใหม่รอตรวจ", `มีสลิปใหม่รอตรวจจากห้อง ${roomNumber} คุณ${tenantName}`, [
    ...rows([
      { label: "ห้อง", value: roomNumber },
      { label: "ผู้เช่า", value: tenantName },
      { label: "ยอดในสลิป", value: amountValue, bold: true },
      { label: "เทียบกับยอดบิล", value: compareValue, bold: true },
    ]),
    separator(),
    note("เปิดหน้าคิวรอตรวจเพื่อปิดบิลหรือปฏิเสธ"),
  ]);
}

export interface TenantBillSummary {
  period: string;
  total: number;
  status: "paid" | "unpaid";
}

export function slipInstructionMessage(): LineFlexMessage {
  return card("info", "ส่งสลิปได้เลย", "ส่งรูปสลิปโอนเงินในแชทนี้ ระบบจะตรวจสอบให้อัตโนมัติ", [
    note("ส่งรูปสลิปโอนเงินในแชทนี้ได้เลย"),
    note("ระบบจะตรวจสอบสลิปให้อัตโนมัติ"),
  ]);
}

export function billStatusMessage(roomNumber: string, bills: readonly TenantBillSummary[]): LineFlexMessage {
  const latest = bills[0];

  if (latest === undefined) {
    return card("info", "ยังไม่มีบิล", `ยังไม่มีบิลของห้อง ${roomNumber} ในระบบ`, [
      note(`ยังไม่มีบิลของห้อง ${roomNumber} ในระบบ`),
      note("เมื่อเจ้าของหอออกบิลแล้วจะแจ้งให้ทราบในแชทนี้"),
    ]);
  }

  const unpaid = bills.filter((bill) => bill.status === "unpaid");
  const outstanding = unpaid[0];

  if (outstanding === undefined) {
    const periodLabel = thaiPeriodLabel(latest.period);
    const totalLabel = `${bahtText(latest.total)} บาท`;

    return card("success", "บิลล่าสุดชำระแล้ว", `บิลห้อง ${roomNumber} ประจำเดือน ${periodLabel} ชำระแล้ว ยอด ${totalLabel}`, [
      ...rows([
        { label: "ห้อง", value: roomNumber },
        { label: "รอบบิล", value: periodLabel },
        { label: "ยอด", value: totalLabel, bold: true },
      ]),
      separator(),
      note("ไม่มียอดค้างชำระ"),
    ]);
  }

  const periodLabel = thaiPeriodLabel(outstanding.period);
  const totalLabel = `${bahtText(outstanding.total)} บาท`;
  const tail = [note("กรุณาชำระและส่งสลิปในแชทนี้")];

  if (unpaid.length > 1) {
    tail.push(note(`มียอดค้างชำระอีก ${unpaid.length - 1} ใบ`));
  }

  return card("warning", "มียอดค้างชำระ", `บิลห้อง ${roomNumber} ประจำเดือน ${periodLabel} ยอด ${totalLabel} ยังไม่ชำระ`, [
    ...rows([
      { label: "ห้อง", value: roomNumber },
      { label: "รอบบิล", value: periodLabel },
      { label: "ยอดค้างชำระ", value: totalLabel, bold: true },
    ]),
    separator(),
    ...tail,
  ]);
}

export function registerRequiredMessage(registerUrl: string): LineFlexMessage {
  return card(
    "warning",
    "ลงทะเบียนก่อนเชื่อม LINE",
    `กรุณาลงทะเบียนผู้เช่าเพื่อผูก LINE กับห้องของคุณก่อน ลงทะเบียนได้ที่ ${registerUrl}`,
    [note("กรุณาลงทะเบียนผู้เช่าเพื่อผูก LINE กับห้องของคุณก่อน"), note(registerUrl)],
    footerButton("เปิดหน้าลงทะเบียน", registerUrl),
  );
}

export function registerLinkMessage(registerUrl: string): LineFlexMessage {
  return card("info", "ลิงก์ลงทะเบียนผู้เช่า", `ลิงก์ลงทะเบียนผู้เช่า ${registerUrl}`, [
    note("เปิดลิงก์นี้เพื่อลงทะเบียนผู้เช่า"),
    note(registerUrl),
  ], footerButton("เปิดหน้าลงทะเบียน", registerUrl));
}

export function contactOwnerMessage(ownerName: string, ownerPhone: string): LineFlexMessage {
  const name = ownerName.trim();
  const phone = ownerPhone.trim();

  if (phone === "") {
    const who = name === "" ? "เจ้าของหอ" : `เจ้าของหอ ${name}`;

    return card("info", "ติดต่อเจ้าของหอ", `${who} ยังไม่ได้บันทึกเบอร์โทรไว้`, [
      note(`${who} ยังไม่ได้บันทึกเบอร์โทรไว้`),
      note("กรุณาฝากคำถามไว้ในแชทนี้แล้วรอการติดต่อกลับ"),
    ]);
  }

  const list: CardRow[] = [];

  if (name !== "") {
    list.push({ label: "เจ้าของหอ", value: name });
  }

  list.push({ label: "เบอร์โทร", value: phone, bold: true });

  return card("info", "ติดต่อเจ้าของหอ", `ติดต่อเจ้าของหอ เบอร์โทร ${phone}`, rows(list));
}
