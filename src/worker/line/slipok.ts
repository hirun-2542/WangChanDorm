import { failureDetail, logLineFailure } from "./api";
import { asRecord } from "../routes/shared";

const slipOkEndpointBase = "https://api.slipok.com/api/line/apikey";

export interface SlipOkResult {
  verified: boolean;
  amount: number | null;
  transRef: string | null;
  date: string | null;
  duplicate: boolean;
  raw: unknown;
}

function notVerified(raw: unknown = null, duplicate = false): SlipOkResult {
  return { verified: false, amount: null, transRef: null, date: null, duplicate, raw };
}

function credential(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
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

function readTimestamp(data: Record<string, unknown>): string | null {
  const date = readText(data.date);

  if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  if (Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    return null;
  }

  const time = readText(data.time);

  if (time === null || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) {
    return date;
  }

  const combined = `${date}T${time.length === 5 ? `${time}:00` : time}+07:00`;
  return Number.isNaN(new Date(combined).getTime()) ? date : combined;
}

function amountMismatch(payload: unknown, root: Record<string, unknown>): SlipOkResult {
  const data = asRecord(root.data) ?? {};

  return {
    verified: true,
    amount: readAmount(data.amount) ?? readAmount(root.amount),
    transRef: readTransRef(data),
    date: readTimestamp(data),
    duplicate: false,
    raw: payload,
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

    return notVerified(payload);
  }

  const data = asRecord(root.data);

  if (data === null) {
    return notVerified(payload);
  }

  const amount = readAmount(data.amount);

  if (amount === null) {
    return notVerified(payload);
  }

  return {
    verified: true,
    amount,
    transRef: readTransRef(data),
    date: readTimestamp(data),
    duplicate: false,
    raw: payload,
  };
}

export async function verifySlip(env: Env, imageUrl: string, expectedAmount: number | null): Promise<SlipOkResult> {
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

  if (imageUrl === "") {
    logLineFailure("slipok verify skipped", "slip image url is empty");
    return notVerified();
  }

  const body: Record<string, unknown> = { url: imageUrl, log: false };

  if (expectedAmount !== null) {
    body.amount = expectedAmount;
  }

  try {
    const response = await fetch(`${slipOkEndpointBase}/${encodeURIComponent(branchId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-authorization": key },
      body: JSON.stringify(body),
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

    return result;
  } catch (error) {
    logLineFailure("slipok verify failed", failureDetail(error));
    return notVerified();
  }
}
