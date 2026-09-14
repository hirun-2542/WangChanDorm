export type ElectricMode = "meter" | "flat";
export type RoomStatus = "vacant" | "occupied";

export interface Room {
  id: string;
  roomNumber: string;
  rent: number;
  waterRate: number | null;
  electricMode: ElectricMode;
  electricRate: number | null;
  waterMeterInit: number;
  electricMeterInit: number;
  status: RoomStatus;
}

export interface RoomInput {
  roomNumber: string;
  rent: number;
  waterRate: number | null;
  electricMode: ElectricMode;
  electricRate: number | null;
  waterMeterInit: number;
  electricMeterInit: number;
}

interface ErrorPayload {
  code: string;
  message: string;
  field?: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly field?: string;

  constructor(message: string, code: string, field?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.field = field;
  }
}

function errorPayloadOf(body: unknown): ErrorPayload | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const record = body as Record<string, unknown>;
  const error = record.error;

  if (typeof error !== "object" || error === null) {
    return null;
  }

  const fields = error as Record<string, unknown>;
  const message = fields.message;
  const code = fields.code;

  if (typeof message !== "string" || typeof code !== "string") {
    return null;
  }

  const field = fields.field;

  return typeof field === "string" ? { code, message, field } : { code, message };
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ", "NETWORK");
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const payload = errorPayloadOf(body);
    throw payload === null ? new ApiError("ทำรายการไม่สำเร็จ", "UNKNOWN") : new ApiError(payload.message, payload.code, payload.field);
  }

  return body as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchRooms(): Promise<Room[]> {
  const body = await apiGet<{ ok: true; rooms: Room[] }>("/api/rooms");
  return body.rooms;
}

export async function createRoom(input: RoomInput): Promise<Room> {
  const body = await apiPost<{ ok: true; room: Room }>("/api/rooms", input);
  return body.room;
}

export async function updateRoom(id: string, input: RoomInput): Promise<Room> {
  const body = await apiPatch<{ ok: true; room: Room }>(`/api/rooms/${encodeURIComponent(id)}`, input);
  return body.room;
}
