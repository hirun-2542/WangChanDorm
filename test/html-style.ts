/**
 * ตัวช่วยตรวจ "หน้าตา" ของหน้า HTML ที่ worker เรนเดอร์เอง
 *
 * หน้าเว็บที่เรนเดอร์จากฝั่ง worker ฝัง `<style>` มากับ HTML จึงตรวจได้จาก
 * สิ่งที่ผู้ใช้ได้รับจริงโดยไม่ต้องมีเครื่องมือเบราว์เซอร์ในชุดเทสต์
 */

/** ดึงเนื้อหาใน `<style>` ก้อนแรกของหน้า คืนค่าว่างเมื่อหน้าไม่มี `<style>` */
export function styleBlock(html: string): string {
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  return match?.[1] ?? "";
}

/** ดึง declarations ของ selector หนึ่งตัวจากสไตล์ชีต คืนค่าว่างเมื่อไม่พบ */
export function ruleDeclarations(styles: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

/** อ่าน `font-size` ที่เป็นพิกเซลของ declarations คืน 0 เมื่อไม่ระบุ */
export function fontSizePx(declarations: string): number {
  const match = declarations.match(/font-size:\s*(\d+(?:\.\d+)?)px/);
  return match === null ? 0 : Number(match[1]);
}

/** อ่านค่าตัวแปรสีแบบ hex จากสไตล์ชีต คืนค่าว่างเมื่อไม่พบหรือไม่ใช่ hex เต็ม */
export function hexToken(styles: string, name: string): string {
  const match = styles.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  return match?.[1] ?? "";
}

/** ความสว่างสัมพัทธ์ตามสูตร WCAG 2.x ของสี hex */
export function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [red, green, blue] = channels;

  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

/** อัตราส่วนคอนทราสต์ระหว่างสองสี (มากกว่า 1 เสมอ) */
export function contrastRatio(foreground: string, background: string): number {
  const high = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const low = Math.min(relativeLuminance(foreground), relativeLuminance(background));

  return (high + 0.05) / (low + 0.05);
}
