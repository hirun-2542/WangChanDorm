import { logLineFailure, failureDetail } from "./api";
import { asRecord } from "../routes/shared";

const verifyEndpoint = "https://api.easyslip.com/v2/verify/bank";

export interface EasySlipResult {
  verified: boolean;
  amount: number | null;
  transRef: string | null;
  date: string | null;
  raw: unknown;
}

function notVerified(raw: unknown = null): EasySlipResult {
  return { verified: false, amount: null, transRef: null, date: null, raw };
}

function apiKey(env: Env): string {
  const key = env.EASYSLIP_API_KEY;
  return typeof key === "string" ? key.trim() : "";
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

function readTransRef(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function readDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return null;
  }

  return Number.isNaN(new Date(trimmed).getTime()) ? null : trimmed;
}

function normalise(payload: unknown): EasySlipResult {
  const root = asRecord(payload);

  if (root === null) {
    return notVerified(payload);
  }

  const data = asRecord(root.data);

  if (root.success !== true || data === null) {
    return notVerified(payload);
  }

  const slip = asRecord(data.rawSlip);

  if (slip === null) {
    return notVerified(payload);
  }

  const transRef = readTransRef(slip.transRef);

  if (transRef === null) {
    return notVerified(payload);
  }

  return {
    verified: true,
    amount: readAmount(data.amountInSlip) ?? readAmount(slip.amount),
    transRef,
    date: readDate(slip.date),
    raw: payload,
  };
}

export async function verifySlip(env: Env, imageUrl: string): Promise<EasySlipResult> {
  const key = apiKey(env);

  if (key === "") {
    logLineFailure("easyslip verify skipped", "EASYSLIP_API_KEY is not configured");
    return notVerified();
  }

  if (imageUrl === "") {
    logLineFailure("easyslip verify skipped", "slip image url is empty");
    return notVerified();
  }

  try {
    const response = await fetch(verifyEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ url: imageUrl }),
    });

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      logLineFailure("easyslip verify failed", `status ${String(response.status)}: response is not json`);
      return notVerified();
    }

    if (!response.ok) {
      logLineFailure("easyslip verify failed", `status ${String(response.status)}`);
      return notVerified(payload);
    }

    return normalise(payload);
  } catch (error) {
    logLineFailure("easyslip verify failed", failureDetail(error));
    return notVerified();
  }
}
