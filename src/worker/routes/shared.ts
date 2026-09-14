export type ErrorCode = "VALIDATION" | "CONFLICT" | "DUPLICATE" | "NOT_FOUND" | "INTERNAL";

export interface ErrorBody {
  ok: false;
  error: { code: ErrorCode; message: string; field?: string };
}

export function errorBody(code: ErrorCode, message: string, field?: string): ErrorBody {
  return field === undefined ? { ok: false, error: { code, message } } : { ok: false, error: { code, message, field } };
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return null;
    }

    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}
