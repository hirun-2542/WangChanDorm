/**
 * ค่าที่เปลี่ยนตามการ deploy ของหน้า `/welcome` — รวมไว้ที่เดียวตามสเปก 0003
 * ("ค่าที่เปลี่ยนตามการ deploy อยู่ในที่เดียวที่แก้ได้ และปล่อยเป็นค่าตั้งต้นว่าง
 * ไว้ก่อน — ห้ามใส่ค่าปลอมลงหน้าเว็บ")
 *
 * ตอน deploy จริง (ตั๋ว 12) เติมค่าจริงทั้งสามที่ไฟล์นี้ที่เดียว ไม่ต้องแก้ที่อื่น
 * ค่าที่เว้นว่างจะไม่ถูกแสดงเป็นลิงก์เลย หน้าเว็บจึงไม่มีลิงก์ที่กดแล้วไปไหนไม่ได้
 */
export interface LandingConfig {
  /** ที่อยู่เข้าเดโมสาธารณะแบบเต็ม — ว่างได้ก่อน deploy */
  demoEntryUrl: string;
  /** อีเมลติดต่อ */
  contactEmail: string;
  /** โปรไฟล์ GitHub ของเจ้าของงาน */
  githubProfileUrl: string;
}

export const landingConfig: LandingConfig = {
  demoEntryUrl: "",
  contactEmail: "",
  githubProfileUrl: "",
};

/**
 * เส้นทางเข้าเดโมจริงจากตั๋ว 06 ใช้เมื่อยังไม่ได้ตั้งที่อยู่เดโมแบบเต็ม
 *
 * เส้นทางนี้ทำงานได้ทุกที่ที่ตัวเดโมเข้าถึงได้ (ตัวเดโมรันแอปเดียวกันทั้งหมด จึง
 * เสิร์ฟ `/welcome` เองด้วย) ส่วน production จะตั้ง `demoEntryUrl` เป็นที่อยู่
 * ของ Worker เดโมตอน deploy จริง
 */
export const demoEntryPath = "/api/demo/enter";

export function demoEntryHref(config: LandingConfig = landingConfig): string {
  return config.demoEntryUrl === "" ? demoEntryPath : config.demoEntryUrl;
}
