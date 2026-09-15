export type ErrorCode = "VALIDATION" | "CONFLICT" | "DUPLICATE" | "NOT_FOUND" | "INTERNAL";

export interface ErrorBody {
  ok: false;
  error: { code: ErrorCode; message: string; field?: string };
}

export const upsertSettingSql =
  "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at";

export function errorBody(code: ErrorCode, message: string, field?: string): ErrorBody {
  return field === undefined ? { ok: false, error: { code, message } } : { ok: false, error: { code, message, field } };
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return asRecord(body);
  } catch {
    return null;
  }
}
