import { failureDetail, lineUploadTimeoutMs, logLineFailure } from "./api";
import { asRecord } from "../routes/shared";

const slipOkEndpointBase = "https://api.slipok.com/api/line/apikey";

/** บัญชีผู้รับที่ผู้ให้บริการอ่านได้จากสลิป ค่าที่ได้ถูกปิดบางส่วนตามรูปแบบของแต่ละธนาคาร */
export interface SlipReceiver {
  proxyType: string | null;
  proxyValue: string | null;
  accountValue: string | null;
}

export interface SlipOkResult {
  verified: boolean;
  amount: number | null;
  transRef: string | null;
  date: string | null;
  duplicate: boolean;
  receiverMismatch: boolean;
  receiver: SlipReceiver | null;
  raw: unknown;
}

function notVerified(raw: unknown = null, duplicate = false): SlipOkResult {
  return {
    verified: false,
    amount: null,
    transRef: null,
    date: null,
    duplicate,
    receiverMismatch: false,
    receiver: null,
    raw,
  };
}

function credential(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function imageExtension(contentType: string): string {
  if (contentType === "image/jpeg") {
    return "jpg";
  }

  if (contentType === "image/webp") {
    return "webp";
  }

  return "png";
}

function readText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function readAmount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  const record = asRecord(value);

  if (record === null) {
    return null;
  }

  return readAmount(record.amount);
}

function readCode(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readTransRef(data: Record<string, unknown>): string | null {
  for (const key of ["transRef", "transRef1", "transactionRef", "ref", "reference"]) {
    const value = readText(data[key]);

    if (value !== null) {
      return value;
    }
  }

  return null;
}

/**
 * SlipOK ส่งเวลาของสลิปมาเป็น transTimestamp (ISO 8601) หรือ transDate
 * (yyyyMMdd) คู่กับ transTime (HH:mm:ss) ตามเวลาประเทศไทย
 */
function readTimestamp(data: Record<string, unknown>): string | null {
  const timestamp = readText(data.transTimestamp);

  if (timestamp !== null) {
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const date = readText(data.transDate);

  if (date === null || !/^\d{8}$/.test(date)) {
    return null;
  }

  const isoDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;

  if (Number.isNaN(new Date(`${isoDate}T00:00:00+07:00`).getTime())) {
    return null;
  }

  const time = readText(data.transTime);

  if (time === null || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) {
    return isoDate;
  }

  const combined = `${isoDate}T${time.length === 5 ? `${time}:00` : time}+07:00`;
  return Number.isNaN(new Date(combined).getTime()) ? isoDate : combined;
}

function readReceiver(data: Record<string, unknown>): SlipReceiver | null {
  const receiver = asRecord(data.receiver);

  if (receiver === null) {
    return null;
  }

  const proxy = asRecord(receiver.proxy);
  const account = asRecord(receiver.account);
  const parsed: SlipReceiver = {
    proxyType: proxy === null ? null : readText(proxy.type),
    proxyValue: proxy === null ? null : readText(proxy.value),
    accountValue: account === null ? null : readText(account.value),
  };

  return parsed.proxyValue === null && parsed.accountValue === null ? null : parsed;
}

function verifiedResult(payload: unknown, data: Record<string, unknown>): SlipOkResult {
  return {
    verified: true,
    amount: readAmount(data.amount),
    transRef: readTransRef(data),
    date: readTimestamp(data),
    duplicate: false,
    receiverMismatch: false,
    receiver: readReceiver(data),
    raw: payload,
  };
}

function amountMismatch(payload: unknown, root: Record<string, unknown>): SlipOkResult {
  const result = verifiedResult(payload, asRecord(root.data) ?? {});

  return { ...result, amount: result.amount ?? readAmount(root.amount) };
}

/** รหัส 1014 คือสลิปจริงแต่โอนเข้าบัญชีที่ไม่ใช่บัญชีรับเงินที่ผูกกับสาขา */
function receiverMismatch(payload: unknown, root: Record<string, unknown>): SlipOkResult {
  const data = asRecord(root.data) ?? {};

  return {
    ...verifiedResult(payload, data),
    verified: false,
    receiverMismatch: true,
  };
}

function normalise(payload: unknown): SlipOkResult {
  const root = asRecord(payload);

  if (root === null) {
    return notVerified(payload);
  }

  if (root.success !== true) {
    const code = readCode(root.code);

    if (code === 1012) {
      return notVerified(payload, true);
    }

    if (code === 1013) {
      return amountMismatch(payload, root);
    }

    if (code === 1014) {
      return receiverMismatch(payload, root);
    }

    return notVerified(payload);
  }

  const data = asRecord(root.data);

  if (data === null || data.success === false) {
    return notVerified(payload);
  }

  const amount = readAmount(data.amount);

  if (amount === null) {
    return notVerified(payload);
  }

  return verifiedResult(payload, data);
}

/** บัญชีรับเงินของหอตามที่ตั้งไว้ในหน้าตั้งค่า */
export interface SlipPayee {
  proxyType: "MSISDN" | "NATID";
  proxyId: string;
  accountNumber: string;
}

export type ReceiverVerdict = "match" | "mismatch" | "unknown";

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * ค่าบัญชีผู้รับจากสลิปถูกปิดบางส่วนเสมอ จึงเทียบได้เต็มรูปแบบเฉพาะเมื่อ
 * ไม่มีตัวปิด ถ้ามีตัวปิดจะเทียบเฉพาะเลขท้าย 4 ตัวซึ่งธนาคารเปิดไว้
 */
function maskedOrExactMatch(received: string, expected: string): boolean {
  const receivedDigits = digitsOnly(received);
  const expectedDigits = digitsOnly(expected);

  if (receivedDigits === "" || expectedDigits === "") {
    return false;
  }

  if (receivedDigits === expectedDigits) {
    return true;
  }

  if (!/[x*]/i.test(received)) {
    return false;
  }

  const tail = Math.min(4, receivedDigits.length, expectedDigits.length);
  return receivedDigits.slice(-tail) === expectedDigits.slice(-tail);
}

/**
 * เทียบผู้รับเงินบนสลิปกับบัญชีที่หอตั้งไว้
 *
 * "unknown" แปลว่าเทียบไม่ได้เลย (ไม่มีข้อมูลฝั่งใดฝั่งหนึ่ง) ซึ่งต่างจาก
 * "mismatch" ที่พิสูจน์ได้ว่าโอนเข้าบัญชีอื่น
 */
export function compareReceiver(receiver: SlipReceiver | null, payee: SlipPayee): ReceiverVerdict {
  const pairs: Array<[string, string]> = [];
  const proxyId = digitsOnly(payee.proxyId);
  const accountNumber = digitsOnly(payee.accountNumber);

  if (proxyId !== "" && receiver !== null && receiver.proxyValue !== null && receiver.proxyType === payee.proxyType) {
    pairs.push([receiver.proxyValue, proxyId]);
  }

  if (accountNumber !== "" && receiver !== null && receiver.accountValue !== null) {
    pairs.push([receiver.accountValue, accountNumber]);
  }

  if (pairs.length === 0) {
    return "unknown";
  }

  return pairs.some(([received, expected]) => maskedOrExactMatch(received, expected)) ? "match" : "mismatch";
}

export async function verifySlip(env: Env, imageBytes: ArrayBuffer, contentType: string, expectedAmount: number | null): Promise<SlipOkResult> {
  const key = credential(env.SLIPOK_API_KEY);
  const branchId = credential(env.SLIPOK_BRANCH_ID);

  if (key === "") {
    logLineFailure("slipok verify skipped", "SLIPOK_API_KEY is not configured");
    return notVerified();
  }

  if (branchId === "") {
    logLineFailure("slipok verify skipped", "SLIPOK_BRANCH_ID is not configured");
    return notVerified();
  }

  if (imageBytes.byteLength === 0) {
    logLineFailure("slipok verify skipped", "slip image is empty");
    return notVerified();
  }

  const body = new FormData();
  body.append("files", new Blob([imageBytes], { type: contentType }), `slip.${imageExtension(contentType)}`);

  // log=true คือให้ผู้ให้บริการเทียบบัญชีผู้รับกับบัญชีที่ผูกกับสาขาและกันสลิปซ้ำ
  // ถ้าปิดค่านี้ สลิปที่โอนเข้าบัญชีอื่นจะผ่านเข้ามาปิดบิลได้
  body.append("log", "true");

  if (expectedAmount !== null) {
    body.append("amount", String(expectedAmount));
  }

  try {
    const response = await fetch(`${slipOkEndpointBase}/${encodeURIComponent(branchId)}`, {
      method: "POST",
      headers: { "x-authorization": key },
      body,
      signal: AbortSignal.timeout(lineUploadTimeoutMs),
    });

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      logLineFailure("slipok verify failed", `status ${String(response.status)}: response is not json`);
      return notVerified();
    }

    if (!response.ok) {
      logLineFailure("slipok verify failed", `status ${String(response.status)}`);
      return notVerified(payload);
    }

    const result = normalise(payload);

    if (result.duplicate) {
      logLineFailure("slipok verify duplicate", "the provider reports this slip was already submitted");
      return result;
    }

    if (!result.verified) {
      const code = readCode(asRecord(payload)?.code);
      const message = readText(asRecord(payload)?.message);
      logLineFailure("slipok verify rejected", `code ${code === null ? "unknown" : String(code)}${message === null ? "" : `: ${message}`}`);
    }

    if (result.receiverMismatch) {
      logLineFailure("slipok verify receiver mismatch", "the provider reports the receiver is not this branch's account");
    }

    return result;
  } catch (error) {
    logLineFailure("slipok verify failed", failureDetail(error));
    return notVerified();
  }
}
