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
  lastElectricAmount: number | null;
  lastElectricPeriod: string | null;
  /** ชุดที่มีผลจริงของห้องนี้ = ค่าใช้จ่ายของหอ − ที่ปิดไว้ + ของห้องเอง (อ่านอย่างเดียว) */
  charges: BillCharge[];
  /** id ของค่าใช้จ่ายระดับหอที่ห้องนี้ปิดไว้ */
  excludedDormChargeIds: string[];
  /** ค่าใช้จ่ายที่เป็นของห้องนี้เอง ไม่ได้มาจากหอ */
  ownCharges: BillCharge[];
}

export interface DormCharge {
  id: string;
  name: string;
  amount: number;
}

export interface DormChargeInput {
  id?: string;
  name: string;
  amount: number;
}

export interface RoomInput {
  roomNumber: string;
  rent: number;
  waterRate: number | null;
  electricMode: ElectricMode;
  electricRate: number | null;
  waterMeterInit: number;
  electricMeterInit: number;
  excludedDormChargeIds?: string[];
  ownCharges?: BillCharge[];
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
  createdAt: string;
}

export type BillPaidMethod = "transfer" | "cash";

export interface BillUpdate {
  waterCurrent?: number;
  electricCurrent?: number;
  flatElectricAmount?: number;
  charges?: BillCharge[];
}

export interface BillPaidInput {
  method: BillPaidMethod;
  paidAt?: string;
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
  charges: BillCharge[];
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
  slipOkConfigured: boolean;
}

export interface Settings {
  dormName: string;
  ownerName: string;
  ownerPhone: string;
  defaultWaterRate: number;
  defaultElectricRate: number;
  promptpayType: PromptpayType;
  promptpayId: string;
  promptpayName: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  ownerLinkCode: string;
  ownerLineConnected: boolean;
  integrations: SettingsIntegrations;
}

export interface SettingsUpdate {
  dormName?: string;
  ownerName?: string;
  ownerPhone?: string;
  defaultWaterRate?: number;
  defaultElectricRate?: number;
  promptpayType?: PromptpayType;
  promptpayId?: string;
  promptpayName?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
}

interface ErrorPayload {
  code: string;
  message: string;
  field?: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly field?: string;
  /** สถานะ HTTP ที่เซิร์ฟเวอร์ตอบกลับ · 0 = คำขอไม่ถึงเซิร์ฟเวอร์ */
  readonly status: number;

  constructor(message: string, code: string, field?: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.field = field;
    this.status = status;
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

  return typeof field === "string"
    ? { code, message, field }
    : { code, message };
}

/** เพดานเวลาต่อคำขอ กันหน้าจอค้างตลอดไปเมื่อเซิร์ฟเวอร์ไม่ตอบ */
const requestTimeoutMs = 20_000;

/**
 * 401 จากเส้นทางเหล่านี้เป็นเรื่องปกติของหน้าเข้าสู่ระบบ (ยังไม่ล็อกอิน หรือรหัสผ่านผิด)
 * หน้าจอที่เรียกจึงจัดการเอง ไม่ต้องพาผู้ใช้ออกจากสิ่งที่กำลังทำอยู่
 */
const selfHandledAuthPaths = [
  "/api/auth/me",
  "/api/auth/login",
  "/api/auth/bootstrap",
  "/api/auth/accept-invite",
];

let unauthorizedHandler: (() => void) | null = null;

/** ให้ AuthProvider ลงทะเบียนผู้รับเหตุ 401 เพื่อพากลับหน้าเข้าสู่ระบบ */
export function onUnauthorized(handler: () => void): () => void {
  unauthorizedHandler = handler;

  return () => {
    if (unauthorizedHandler === handler) {
      unauthorizedHandler = null;
    }
  };
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;

  // ไฟล์นี้ถูก import จากทั้งฝั่ง client (lib.dom RequestInit มี credentials)
  // และจากชุดทดสอบฝั่ง worker (workers-types RequestInit ไม่มี credentials)
  // ประกาศชนิดเป็น intersection เอง เพื่อให้คอมไพล์ผ่านทั้งสองฝั่งโดยไม่ใช้ any
  const requestInit: RequestInit & { credentials?: string } = {
    ...init,
    credentials: "same-origin",
    signal: init.signal ?? AbortSignal.timeout(requestTimeoutMs),
  };

  try {
    response = await fetch(path, requestInit);
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiError("เซิร์ฟเวอร์ไม่ตอบสนอง กรุณาลองใหม่", "TIMEOUT");
    }

    throw new ApiError("เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ", "NETWORK");
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (
      response.status === 401 &&
      !selfHandledAuthPaths.some((known) => path.startsWith(known))
    ) {
      unauthorizedHandler?.();
    }

    const payload = errorPayloadOf(body);
    throw payload === null
      ? new ApiError("ทำรายการไม่สำเร็จ", "UNKNOWN", undefined, response.status)
      : new ApiError(
          payload.message,
          payload.code,
          payload.field,
          response.status,
        );
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

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
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
  const body = await apiPatch<{ ok: true; room: Room }>(
    `/api/rooms/${encodeURIComponent(id)}`,
    input,
  );
  return body.room;
}

export async function fetchTenants(): Promise<Tenant[]> {
  const body = await apiGet<{ ok: true; tenants: Tenant[] }>("/api/tenants");
  return body.tenants;
}

export async function createTenant(input: TenantInput): Promise<Tenant> {
  const body = await apiPost<{ ok: true; tenant: Tenant }>(
    "/api/tenants",
    input,
  );
  return body.tenant;
}

export async function updateTenant(
  id: string,
  input: TenantUpdate,
): Promise<Tenant> {
  const body = await apiPatch<{ ok: true; tenant: Tenant }>(
    `/api/tenants/${encodeURIComponent(id)}`,
    input,
  );
  return body.tenant;
}

export async function checkoutTenant(
  id: string,
  checkOutDate: string,
): Promise<Tenant> {
  const body = await apiPost<{ ok: true; tenant: Tenant }>(
    `/api/tenants/${encodeURIComponent(id)}/checkout`,
    { checkOutDate },
  );
  return body.tenant;
}

export async function fetchSettings(): Promise<Settings> {
  const body = await apiGet<{ ok: true; settings: Settings }>("/api/settings");
  return body.settings;
}

export async function fetchDormCharges(): Promise<DormCharge[]> {
  const body = await apiGet<{ ok: true; charges: DormCharge[] }>(
    "/api/settings/charges",
  );
  return body.charges;
}

export async function saveDormCharges(
  charges: DormChargeInput[],
): Promise<DormCharge[]> {
  const body = await apiPut<{ ok: true; charges: DormCharge[] }>(
    "/api/settings/charges",
    { charges },
  );
  return body.charges;
}

export async function fetchPendingLinks(): Promise<PendingLink[]> {
  const body = await apiGet<{ ok: true; pending: PendingLink[] }>(
    "/api/line/pending",
  );
  return body.pending;
}

export async function linkPendingUser(
  lineUserId: string,
  tenantId: string,
): Promise<void> {
  await apiPost<{ ok: true }>(
    `/api/line/pending/${encodeURIComponent(lineUserId)}/link`,
    { tenantId },
  );
}

export type LineMessageAudience = "tenant" | "owner";

export interface LineFlexCard {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
}

export interface LineMessageKind {
  key: string;
  title: string;
  audience: LineMessageAudience;
  trigger: string;
  message: LineFlexCard;
}

export interface LineMessageSource {
  period: string;
  roomNumber: string;
  tenantName: string;
}

export interface LineMessagesResult {
  source: LineMessageSource | null;
  messages: LineMessageKind[];
}

export async function fetchLineMessages(): Promise<LineMessagesResult> {
  const body = await apiGet<{
    ok: true;
    source: LineMessageSource | null;
    messages: LineMessageKind[];
  }>("/api/line/messages");
  return { source: body.source, messages: body.messages };
}

export async function updateSettings(input: SettingsUpdate): Promise<Settings> {
  const body = await apiPut<{ ok: true; settings: Settings }>(
    "/api/settings",
    input,
  );
  return body.settings;
}

export async function regenerateOwnerCode(): Promise<string> {
  const body = await apiPost<{ ok: true; ownerLinkCode: string }>(
    "/api/settings/owner-code",
    {},
  );
  return body.ownerLinkCode;
}

export async function fetchBills(period: string): Promise<Bill[]> {
  const body = await apiGet<{ ok: true; period: string; bills: Bill[] }>(
    `/api/bills?period=${encodeURIComponent(period)}`,
  );
  return body.bills;
}

export async function fetchBillPeriods(): Promise<string[]> {
  const body = await apiGet<{ ok: true; periods: string[] }>(
    "/api/bills/periods",
  );
  return body.periods;
}

export interface BillsFocus {
  roomNumber: string;
  period: string;
}

export function billsFocusTarget(
  room: { roomNumber: string; lastElectricPeriod: string | null },
  fallbackPeriod: string | null,
): BillsFocus {
  return {
    roomNumber: room.roomNumber,
    period: room.lastElectricPeriod ?? fallbackPeriod ?? "",
  };
}

export function billsFocusHash(focus: BillsFocus): string {
  const params = new URLSearchParams();
  params.set("room", focus.roomNumber);

  if (focus.period !== "") {
    params.set("period", focus.period);
  }

  return `#bills?${params.toString()}`;
}

export function billsFocusOf(hash: string): BillsFocus | null {
  const [routePart = "", searchPart = ""] = hash.replace(/^#/, "").split("?");

  if (routePart !== "bills" || searchPart === "") {
    return null;
  }

  const params = new URLSearchParams(searchPart);
  const roomNumber = params.get("room") ?? "";

  if (roomNumber === "") {
    return null;
  }

  return { roomNumber, period: params.get("period") ?? "" };
}

export async function fetchMeterSheet(
  period: string,
): Promise<MeterSheetRow[]> {
  const body = await apiGet<{
    ok: true;
    period: string;
    rows: MeterSheetRow[];
  }>(`/api/bills/meter-sheet?period=${encodeURIComponent(period)}`);
  return body.rows;
}

export async function generateBills(
  period: string,
  entries: BillEntryInput[],
): Promise<Bill[]> {
  const body = await apiPost<{ ok: true; bills: Bill[] }>(
    "/api/bills/generate",
    { period, entries },
  );
  return body.bills;
}

export async function updateBill(id: string, input: BillUpdate): Promise<Bill> {
  const body = await apiPatch<{ ok: true; bill: Bill }>(
    `/api/bills/${encodeURIComponent(id)}`,
    input,
  );
  return body.bill;
}

export async function deleteBill(id: string): Promise<void> {
  await apiDelete<{ ok: true }>(`/api/bills/${encodeURIComponent(id)}`);
}

export async function markBillPaid(
  id: string,
  input: BillPaidInput,
): Promise<Bill> {
  const body = await apiPost<{ ok: true; bill: Bill }>(
    `/api/bills/${encodeURIComponent(id)}/mark-paid`,
    input,
  );
  return body.bill;
}

export interface SkippedBill {
  roomNumber: string;
  tenantName: string;
}

export interface SendAllResult {
  period: string;
  sent: number;
  failed: number;
  failedIds: string[];
  skipped: SkippedBill[];
}

export async function sendBill(id: string): Promise<Bill> {
  const body = await apiPost<{ ok: true; bill: Bill }>(
    `/api/bills/${encodeURIComponent(id)}/send`,
    {},
  );
  return body.bill;
}

export async function sendBills(
  period: string,
  billIds?: string[],
): Promise<SendAllResult> {
  const body = await apiPost<{
    ok: true;
    period: string;
    sent: number;
    failed: number;
    failedIds: string[];
    skipped: SkippedBill[];
  }>(
    "/api/bills/send-all",
    billIds === undefined ? { period } : { period, billIds },
  );

  return {
    period: body.period,
    sent: body.sent,
    failed: body.failed,
    failedIds: body.failedIds,
    skipped: body.skipped,
  };
}

export type SlipStatus = "pending_review" | "matched" | "rejected";

export type SlipReason =
  "mismatch" | "not_verified" | "no_unpaid_bill" | "duplicate_slip";

export type SlipResolveAction = "settle" | "reject";

export interface SlipBill {
  id: string;
  roomNumber: string;
  tenantName: string;
  period: string;
  total: number;
}

export interface Slip {
  id: string;
  createdAt: string;
  imageKey: string;
  imageUrl: string;
  status: SlipStatus;
  reason: SlipReason | null;
  slipAmount: number | null;
  bill: SlipBill | null;
  verified: boolean;
  verify: { verified: boolean; transRef: string | null; date: string | null };
  transferAt: string | null;
}

export interface SlipQuery {
  status?: SlipStatus;
  billId?: string;
}

export async function fetchSlips(query: SlipQuery = {}): Promise<Slip[]> {
  const params = new URLSearchParams();

  if (query.status !== undefined) {
    params.set("status", query.status);
  }

  if (query.billId !== undefined) {
    params.set("billId", query.billId);
  }

  const search = params.toString();
  const body = await apiGet<{ ok: true; slips: Slip[] }>(
    `/api/slips${search === "" ? "" : `?${search}`}`,
  );

  return body.slips;
}

export async function resolveSlip(
  id: string,
  action: SlipResolveAction,
  billId?: string,
): Promise<Slip> {
  const payload: { action: SlipResolveAction; billId?: string } =
    billId === undefined ? { action } : { action, billId };
  const body = await apiPost<{ ok: true; slip: Slip }>(
    `/api/slips/${encodeURIComponent(id)}/resolve`,
    payload,
  );

  return body.slip;
}

export const reviewQueueChangedEvent = "wangchan:review-queue-changed";

export function announceReviewQueueChanged(): void {
  const target = globalThis as unknown as EventTarget;
  target.dispatchEvent(new Event(reviewQueueChangedEvent));
}

export const billsChangedEvent = "wangchan:bills-changed";

/** บอกหน้ารายการบิลว่าชุดบิลเปลี่ยนแล้ว (สร้าง/ส่ง/แก้/ลบ) ให้โหลดใหม่ */
export function announceBillsChanged(): void {
  const target = globalThis as unknown as EventTarget;
  target.dispatchEvent(new Event(billsChangedEvent));
}

export interface DashboardKpis {
  bills: number;
  dueAmount: number;
  collectedAmount: number;
  unpaidAmount: number;
  unpaidRooms: number;
  unbilledRooms: number;
  vacantRooms: number;
  totalRooms: number;
  sentCount: number;
  paidCount: number;
}

export interface RevenuePoint {
  period: string;
  amount: number;
}

export interface UnpaidBillStat {
  id: string;
  roomNumber: string;
  tenantName: string;
  total: number;
  createdAt: string;
  sentAt: string | null;
  hasPendingSlip: boolean;
}

export type DashboardRoomStatus = "paid" | "unpaid" | "unbilled" | "vacant";

export interface DashboardRoom {
  id: string;
  roomNumber: string;
  status: DashboardRoomStatus;
  hasPendingSlip: boolean;
  lastBilledPeriod: string | null;
  behindPeriods: number;
}

export interface DashboardStats {
  period: string;
  latestBilledPeriod: string | null;
  kpis: DashboardKpis;
  revenue: RevenuePoint[];
  unpaidBills: UnpaidBillStat[];
  rooms: DashboardRoom[];
}

export async function fetchDashboardStats(
  period: string,
): Promise<DashboardStats> {
  const body = await apiGet<{ ok: true } & DashboardStats>(
    `/api/stats/dashboard?period=${encodeURIComponent(period)}`,
  );

  return {
    period: body.period,
    latestBilledPeriod: body.latestBilledPeriod,
    kpis: body.kpis,
    revenue: body.revenue,
    unpaidBills: body.unpaidBills,
    rooms: body.rooms,
  };
}

export type FamilyRole = "owner" | "member";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: FamilyRole;
  familyId: string;
}

export async function fetchMe(): Promise<AuthUser> {
  const body = await apiGet<{ ok: true; user: AuthUser }>("/api/auth/me");
  return body.user;
}

export async function login(email: string, password: string): Promise<void> {
  await apiPost<{ ok: true }>("/api/auth/login", { email, password });
}

export async function logout(): Promise<void> {
  await apiPost<{ ok: true }>("/api/auth/logout", {});
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await apiPost<{ ok: true }>("/api/auth/password", {
    currentPassword,
    newPassword,
  });
}

export interface BootstrapInput {
  secret: string;
  email: string;
  displayName: string;
  password: string;
  /** เว้นว่างได้เมื่อระบบยังไม่มีเจ้าของ และจะรับช่วงข้อมูลหอเดิม */
  familyName?: string;
}

export interface BootstrapResult {
  user: AuthUser;
  /** true = รับช่วงข้อมูลหอเดิม false = สร้างครอบครัวใหม่ที่เริ่มจากข้อมูลว่าง */
  claimedExistingData: boolean;
}

export async function bootstrap(input: BootstrapInput): Promise<BootstrapResult> {
  const body = await apiPost<{
    ok: true;
    claimedExistingData: boolean;
    user: AuthUser;
  }>("/api/auth/bootstrap", input);

  return { user: body.user, claimedExistingData: body.claimedExistingData };
}

export async function acceptInvite(input: {
  token: string;
  displayName: string;
  password: string;
}): Promise<void> {
  await apiPost<{ ok: true }>("/api/auth/accept-invite", input);
}

export interface FamilyInfo {
  id: string;
  name: string;
}

export interface FamilyMember {
  userId: string;
  email: string;
  displayName: string;
  role: FamilyRole;
  joinedAt: string;
}

export interface FamilyInvite {
  id: string;
  email: string;
  role: FamilyRole;
  createdAt: string;
  expiresAt: string;
}

export interface FamilyOverview {
  family: FamilyInfo;
  members: FamilyMember[];
  invites: FamilyInvite[];
}

export interface CreatedInvite {
  email: string;
  role: FamilyRole;
  expiresAt: string;
  /** คืนมาเต็มครั้งเดียวตอนออกคำเชิญเท่านั้น ฐานข้อมูลเก็บแค่ค่าแฮช */
  token: string;
  url: string;
}

export async function fetchFamily(): Promise<FamilyOverview> {
  const body = await apiGet<{ ok: true } & FamilyOverview>("/api/family");

  return {
    family: body.family,
    members: body.members,
    invites: body.invites,
  };
}

export async function renameFamily(name: string): Promise<FamilyInfo> {
  const body = await apiPatch<{ ok: true; family: FamilyInfo }>(
    "/api/family",
    { name },
  );

  return body.family;
}

export async function createFamilyInvite(
  email: string,
  role: FamilyRole,
): Promise<CreatedInvite> {
  const body = await apiPost<{ ok: true; invite: CreatedInvite }>(
    "/api/family/invites",
    { email, role },
  );

  return body.invite;
}

export async function revokeFamilyInvite(id: string): Promise<void> {
  await apiDelete<{ ok: true }>(
    `/api/family/invites/${encodeURIComponent(id)}`,
  );
}

export async function setFamilyMemberRole(
  userId: string,
  role: FamilyRole,
): Promise<void> {
  await apiPatch<{ ok: true }>(
    `/api/family/members/${encodeURIComponent(userId)}`,
    { role },
  );
}

export async function removeFamilyMember(userId: string): Promise<void> {
  await apiDelete<{ ok: true }>(
    `/api/family/members/${encodeURIComponent(userId)}`,
  );
}
