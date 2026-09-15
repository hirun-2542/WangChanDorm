export type ElectricMode = "meter" | "flat";
export type RoomStatus = "vacant" | "occupied";
export type TenantStatus = "current" | "moved-out";

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
  occupiedBy: string | null;
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

export interface Tenant {
  id: string;
  fullName: string;
  phone: string;
  roomId: string;
  roomNumber: string;
  checkInDate: string;
  checkOutDate: string | null;
  lineUserId: string | null;
  status: TenantStatus;
}

export interface TenantInput {
  fullName: string;
  phone: string;
  roomId: string;
  checkInDate: string;
}

export interface TenantUpdate {
  fullName?: string;
  phone?: string;
  checkInDate?: string;
}

export interface PendingLink {
  lineUserId: string;
  displayName: string;
  lastMessage: string | null;
  lastSeenAt: string;
}

export interface BillCharge {
  name: string;
  amount: number;
}

export type BillStatus = "paid" | "unpaid";

export interface Bill {
  id: string;
  roomId: string;
  roomNumber: string;
  tenantId: string;
  tenantName: string;
  period: string;
  rent: number;
  waterPrevious: number;
  waterCurrent: number;
  waterUnits: number;
  waterRate: number;
  waterAmount: number;
  electricMode: ElectricMode;
  electricPrevious: number;
  electricCurrent: number;
  electricUnits: number | null;
  electricRate: number | null;
  electricAmount: number;
  charges: BillCharge[];
  total: number;
  status: BillStatus;
  paidAt: string | null;
  paidMethod: string | null;
  sentAt: string | null;
}

export interface MeterSheetRow {
  roomId: string;
  roomNumber: string;
  tenantId: string;
  tenantName: string;
  rent: number;
  waterRate: number;
  electricMode: ElectricMode;
  electricRate: number | null;
  waterPrevious: number;
  electricPrevious: number;
  existingBillId: string | null;
}

export interface BillEntryInput {
  roomId: string;
  waterCurrent: number;
  electricCurrent: number;
  flatElectricAmount?: number;
  charges?: BillCharge[];
}

export type PromptpayType = "phone" | "citizen-id";

export interface SettingsIntegrations {
  lineConfigured: boolean;
  easySlipConfigured: boolean;
}

export interface Settings {
  dormName: string;
  ownerName: string;
  defaultWaterRate: number;
  defaultElectricRate: number;
  promptpayType: PromptpayType;
  promptpayId: string;
  promptpayName: string;
  ownerLinkCode: string;
  ownerLineConnected: boolean;
  integrations: SettingsIntegrations;
}

export interface SettingsUpdate {
  dormName?: string;
  ownerName?: string;
  defaultWaterRate?: number;
  defaultElectricRate?: number;
  promptpayType?: PromptpayType;
  promptpayId?: string;
  promptpayName?: string;
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

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "PUT",
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

export async function fetchTenants(): Promise<Tenant[]> {
  const body = await apiGet<{ ok: true; tenants: Tenant[] }>("/api/tenants");
  return body.tenants;
}

export async function createTenant(input: TenantInput): Promise<Tenant> {
  const body = await apiPost<{ ok: true; tenant: Tenant }>("/api/tenants", input);
  return body.tenant;
}

export async function updateTenant(id: string, input: TenantUpdate): Promise<Tenant> {
  const body = await apiPatch<{ ok: true; tenant: Tenant }>(`/api/tenants/${encodeURIComponent(id)}`, input);
  return body.tenant;
}

export async function checkoutTenant(id: string, checkOutDate: string): Promise<Tenant> {
  const body = await apiPost<{ ok: true; tenant: Tenant }>(`/api/tenants/${encodeURIComponent(id)}/checkout`, { checkOutDate });
  return body.tenant;
}

export async function fetchSettings(): Promise<Settings> {
  const body = await apiGet<{ ok: true; settings: Settings }>("/api/settings");
  return body.settings;
}

export async function fetchPendingLinks(): Promise<PendingLink[]> {
  const body = await apiGet<{ ok: true; pending: PendingLink[] }>("/api/line/pending");
  return body.pending;
}

export async function linkPendingUser(lineUserId: string, tenantId: string): Promise<void> {
  await apiPost<{ ok: true }>(`/api/line/pending/${encodeURIComponent(lineUserId)}/link`, { tenantId });
}

export async function updateSettings(input: SettingsUpdate): Promise<Settings> {
  const body = await apiPut<{ ok: true; settings: Settings }>("/api/settings", input);
  return body.settings;
}

export async function regenerateOwnerCode(): Promise<string> {
  const body = await apiPost<{ ok: true; ownerLinkCode: string }>("/api/settings/owner-code", {});
  return body.ownerLinkCode;
}

export async function fetchBills(period: string): Promise<Bill[]> {
  const body = await apiGet<{ ok: true; period: string; bills: Bill[] }>(`/api/bills?period=${encodeURIComponent(period)}`);
  return body.bills;
}

export async function fetchMeterSheet(period: string): Promise<MeterSheetRow[]> {
  const body = await apiGet<{ ok: true; period: string; rows: MeterSheetRow[] }>(
    `/api/bills/meter-sheet?period=${encodeURIComponent(period)}`,
  );
  return body.rows;
}

export async function generateBills(period: string, entries: BillEntryInput[]): Promise<Bill[]> {
  const body = await apiPost<{ ok: true; bills: Bill[] }>("/api/bills/generate", { period, entries });
  return body.bills;
}
