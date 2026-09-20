import { env } from "cloudflare:test";
import { hashToken, sessionCookieName } from "../src/worker/lib/session";

/** ครอบครัวที่ migration 0010 สร้างไว้ให้ข้อมูลเดิม เทสต์ทุกไฟล์ใช้ก้อนนี้ */
export const testFamilyId = "00000000-0000-4000-8000-000000000001";

let counter = 0;

export interface TestSession {
  cookie: string;
  userId: string;
  familyId: string;
}

/**
 * สร้างผู้ใช้ + เซสชันจริงลงฐานข้อมูลแล้วคืนค่า Cookie ที่ใช้ยิง API ได้
 *
 * เขียนตรงลงตารางแทนการเข้าสู่ระบบจริง เพราะทั้งระบบเข้าด้วย Google ทางเดียว
 * การจะได้เซสชันจริงในเทสต์ต้องผ่าน OAuth ซึ่งไม่ใช่สิ่งที่เทสต์เหล่านี้วัด
 * ส่วนเส้นทาง Google มีเทสต์ของตัวเองใน test/auth.test.ts
 *
 * password_hash เก็บเป็นค่าว่างเพราะไม่มีรหัสผ่านในระบบแล้ว คอลัมน์ยัง NOT NULL
 */
export async function signIn(
  role: "owner" | "member" = "owner",
  familyId: string = testFamilyId,
): Promise<TestSession> {
  counter += 1;

  const userId = crypto.randomUUID();
  const token = crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString().replace("T", " ").slice(0, 19);

  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, '')").bind(
      userId,
      `test-${counter}-${userId.slice(0, 8)}@example.com`,
      `ผู้ทดสอบ ${counter}`,
    ),
    env.DB.prepare("INSERT INTO family_members (family_id, user_id, role) VALUES (?, ?, ?)").bind(
      familyId,
      userId,
      role,
    ),
    env.DB.prepare("INSERT INTO sessions (token_hash, user_id, family_id, expires_at) VALUES (?, ?, ?, ?)").bind(
      await hashToken(token),
      userId,
      familyId,
      expiresAt,
    ),
  ]);

  return { cookie: `${sessionCookieName}=${token}`, userId, familyId };
}

/**
 * ให้ครอบครัวมีช่องทางรับเงินก่อนออกบิล — /api/bills/generate ปฏิเสธถ้า
 * ไม่มีทั้งพร้อมเพย์และบัญชีธนาคารเลย (ดู migration 0011 และ payee snapshot)
 * เขียนตรงลง settings แทนยิง PUT /api/settings เพื่อไม่ต้องพึ่งฟิลด์อื่น
 * ที่ settings บังคับ (ชื่อหอ อัตราน้ำไฟ) ในทุกไฟล์ที่แค่อยากให้ generate ผ่าน
 */
export async function configurePayout(
  familyId: string = testFamilyId,
  promptpayId = "0812345678",
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO settings (family_id, key, value) VALUES (?, 'promptpay_id', ?) ON CONFLICT(family_id, key) DO UPDATE SET value = excluded.value",
  )
    .bind(familyId, promptpayId)
    .run();
  await env.DB.prepare(
    "INSERT INTO settings (family_id, key, value) VALUES (?, 'promptpay_type', 'phone') ON CONFLICT(family_id, key) DO UPDATE SET value = excluded.value",
  )
    .bind(familyId)
    .run();
}

/** ครอบครัวที่สองสำหรับพิสูจน์ว่าข้อมูลข้ามครอบครัวมองไม่เห็นกัน */
export async function createFamily(name = "ครอบครัวทดสอบอื่น"): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO families (id, name) VALUES (?, ?)").bind(id, name).run();

  return id;
}

/** ใส่ cookie ให้ init ของ fetch โดยไม่ทับ header เดิม */
export function withAuth(session: TestSession, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), cookie: session.cookie },
  };
}
