import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { contrastRatio, hexToken, ruleDeclarations, styleBlock } from "./html-style";

const appTitle = "ระบบจัดการหอพัก";
const landingUrl = "https://dorm.test/welcome";

/**
 * หน้าแนะนำโปรเจคเป็นหน้าสาธารณะที่ต้องไม่พึ่งฐานข้อมูลและไม่ต้องมีเซสชัน
 * เทสต์ในไฟล์นี้จึงไม่สร้างผู้ใช้ ห้อง หรือบิลใดเลย โดยเจตนา
 */
function landing(): Promise<Response> {
  return SELF.fetch(landingUrl);
}

describe("GET /welcome", () => {
  it("serves the landing page to an anonymous visitor", async () => {
    const response = await landing();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const html = await response.text();
    expect(html).toContain("<title>หอพักวังจันทร์ — แนะนำโปรเจค</title>");
    expect(html).toContain('lang="th"');
  });

  /**
   * เคสนี้พิสูจน์ว่าเรนเดอร์หน้าตัวเองออกมา ไม่ได้คืน markup ของ SPA
   *
   * การที่พาธนี้ไม่ถูก `not_found_handling` กลบด้วย `index.html` ของ asset server
   * ตรวจในพูลนี้ไม่ได้ (พูลไม่เสิร์ฟ asset) — ยืนยันด้วยการยิง `wrangler dev`
   * จริงหลัง `npm run build` แล้วดูเนื้อหา ไม่ใช่แค่สถานะ
   */
  it("serves the landing page itself, not the app shell markup", async () => {
    const html = await (await landing()).text();

    expect(html).not.toContain(`<title>หอพักวังจันทร์ — ${appTitle}</title>`);
    expect(html).not.toContain('id="root"');
  });

  it("carries the description and an absolute share card for the page itself", async () => {
    const html = await (await landing()).text();

    expect(html).toMatch(/<meta name="description" content="[^"]{40,}" \/>/);
    expect(html).toContain('<meta property="og:type" content="website"');
    expect(html).toContain('<meta property="og:url" content="https://dorm.test/welcome"');
    expect(html).toContain('<meta property="og:image" content="https://dorm.test/welcome-media/og.png"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
  });

  it("offers a way back to the running system", async () => {
    const html = await (await landing()).text();

    expect(html).toContain('href="/"');
    expect(html).toContain("เปิดระบบ");
  });

  it("points every in-page link at a section that exists", async () => {
    const html = await (await landing()).text();
    const targets = Array.from(html.matchAll(/href="#([^"]+)"/g), (match) => match[1]);

    expect(targets.length).toBeGreaterThan(0);

    for (const target of targets) {
      expect(html).toContain(`id="${target}"`);
    }
  });

  it("opens with the claim and the three numbers that back it", async () => {
    const html = await (await landing()).text();

    expect(html).toContain("จากสมุดจด");
    expect(html).toContain("สู่บิลที่ส่งเองทั้งหอ");
    expect(html).toContain("ห้องสูงสุดต่อหอ");
    expect(html).toContain("หน้าจอต่อรอบบิล");
    expect(html).toContain("แอปที่ผู้เช่าต้องติดตั้ง");
  });

  it("plays the recorded round with both formats, a poster and a reserved box", async () => {
    const html = await (await landing()).text();
    const video = html.match(/<video[^>]*>[\s\S]*?<\/video>/)?.[0] ?? "";

    expect(video).toContain("controls");
    expect(video).toContain("playsinline");
    expect(video).toContain('preload="none"');
    expect(video).toContain('poster="/welcome-media/poster.jpg"');
    expect(video).toContain('width="1280"');
    expect(video).toContain('height="800"');
    expect(video).toContain('<source src="/welcome-media/demo.webm" type="video/webm"');
    expect(video).toContain('<source src="/welcome-media/demo.mp4" type="video/mp4"');

    expect(html).toContain('<img src="/welcome-media/hero-bills.webp" width="1510" height="1045"');
  });

  it("labels everything on the page as sample data", async () => {
    const html = await (await landing()).text();

    expect(html).toContain("ภาพหน้าจอจากข้อมูลตัวอย่าง");
    expect(html).toContain("ข้อมูลห้อง ผู้เช่า และยอดเงินในคลิปเป็นข้อมูลตัวอย่างทั้งหมด");
  });

  it("walks the monthly ritual as five numbered steps", async () => {
    const html = await (await landing()).text();
    const section = html.slice(html.indexOf('id="flow"'), html.indexOf('id="what"'));
    const numbers = Array.from(section.matchAll(/class="step-num num"[^>]*>(\d\d)</g), (match) => match[1]);

    expect(numbers).toEqual(["01", "02", "03", "04", "05"]);

    for (const title of ["อ่านมิเตอร์", "กรอกหน้าเดียว", "สร้างบิลทั้งหอ", "ส่งเข้า LINE", "สลิปเข้า ปิดบิล"]) {
      expect(section).toContain(`<h3>${title}</h3>`);
    }
  });

  it("lists the three duties and the four decisions that shaped the system", async () => {
    const html = await (await landing()).text();
    const duties = html.slice(html.indexOf('id="what"'), html.indexOf('id="build"'));
    const decisions = html.slice(html.indexOf('id="build"'));

    expect(duties).toContain("<h3>บิลรายเดือน</h3><p>หนึ่งบิลต่อห้องต่อเดือน");
    expect(duties).toContain("<h3>ช่องทาง LINE</h3><p>ผู้เช่าเชื่อมบัญชีด้วยการพิมพ์เลขห้อง");
    expect(duties).toContain("<h3>ตรวจสลิป</h3><p>สลิปที่ส่งเข้ามาถูกเก็บไว้");

    expect(decisions).toContain("<h3>ราคาถูกตรึงไว้ในบิล</h3><p>บิลเก็บราคาไว้ ณ วันสร้าง");
    expect(decisions).toContain("<h3>ไม่มีงานตั้งเวลา</h3><p>ไม่มี cron");
    expect(decisions).toContain("<h3>ผู้เช่าไม่มีบัญชี</h3><p>ไม่มีหน้าจอ");
    expect(decisions).toContain("<h3>เข้าระบบด้วย Google เท่านั้น</h3><p>ไม่มีรหัสผ่านเก็บอยู่ในระบบเลย</p>");
  });

  it("names the nine technologies the system actually runs on", async () => {
    const html = await (await landing()).text();
    const section = html.slice(html.indexOf('id="build"'));
    const pairs = Array.from(section.matchAll(/<dt>([^<]+)<\/dt><dd>([^<]+)<\/dd>/g), (match) => [match[1], match[2]]);

    expect(pairs).toEqual([
      ["รันบน", "Cloudflare Workers"],
      ["ฐานข้อมูล", "Cloudflare D1 (SQLite)"],
      ["ไฟล์สลิป", "Cloudflare R2"],
      ["เราเตอร์ฝั่งเซิร์ฟเวอร์", "Hono"],
      ["หน้าเว็บ", "React 19 + Vite + Tailwind CSS 4"],
      ["ใบแจ้งหนี้ PDF", "pdf-lib"],
      ["QR พร้อมเพย์", "uqr"],
      ["แชทบอท", "LINE Messaging API"],
      ["ทดสอบ", "Vitest บน workerd"],
    ]);
  });

  it("keeps the sections in the order the page reads them", async () => {
    const html = await (await landing()).text();
    const order = ['id="demo"', 'id="flow"', 'id="what"', 'id="build"', 'class="footer"'].map((marker) =>
      html.indexOf(marker),
    );

    expect(order.every((index) => index > 0)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it("closes with the brand, the sample-data note and a way into the system", async () => {
    const html = await (await landing()).text();
    const footer = html.slice(html.indexOf('class="footer"'));

    expect(footer).toContain("วจ");
    expect(footer).toContain("หอพักวังจันทร์");
    expect(footer).toContain("ข้อมูลทั้งหมดที่แสดงในหน้านี้เป็นข้อมูลตัวอย่าง");
    expect(footer).toContain('<a class="btn btn-primary" href="/">เปิดระบบ</a>');
  });

  it("keeps the brand voice free of exclamation marks", async () => {
    const html = await (await landing()).text();
    const copy = html
      .replace(/<!doctype[^>]*>/i, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "");

    expect(copy).not.toContain("!");
  });
});

describe("GET /welcome composition", () => {
  it("stacks the hero on narrow screens and splits it in two from 960px up", async () => {
    const styles = styleBlock(await (await landing()).text());
    const wide = styles.slice(styles.indexOf("@media (min-width: 960px)"));

    expect(ruleDeclarations(styles, ".hero-grid")).toContain("display: grid");
    expect(ruleDeclarations(wide, ".hero-grid")).toContain("grid-template-columns: 1fr 1fr");
    expect(ruleDeclarations(styles, ".btn")).toContain("min-height: 44px");
  });

  it("lays the steps and the duty cards out in columns that widen with the screen", async () => {
    const styles = styleBlock(await (await landing()).text());
    const medium = styles.slice(styles.indexOf("@media (min-width: 640px)"), styles.indexOf("@media (min-width: 960px)"));
    const wide = styles.slice(styles.indexOf("@media (min-width: 960px)"));

    expect(ruleDeclarations(styles, ".steps")).toContain("gap: 1px");
    expect(ruleDeclarations(styles, ".steps")).toContain("background: var(--ash)");
    expect(ruleDeclarations(styles, ".step")).toContain("background: var(--white)");
    expect(ruleDeclarations(styles, ".step-num")).toContain("color: var(--blue)");
    // คำอธิบายต้องผูกกับย่อหน้าที่ตามหลังหัวข้อเท่านั้น ไม่ใช่ `.step p` ที่จะทับสีของเลขลำดับ
    expect(ruleDeclarations(styles, ".step h3 + p")).toContain("color: var(--steel)");
    expect(ruleDeclarations(styles, ".step p")).toBe("");
    expect(ruleDeclarations(medium, ".steps")).toContain("repeat(2, 1fr)");
    expect(ruleDeclarations(wide, ".steps")).toContain("repeat(5, 1fr)");
    expect(ruleDeclarations(wide, ".cards")).toContain("repeat(3, 1fr)");
    expect(ruleDeclarations(wide, ".build-grid")).toContain("1fr 1fr");
    expect(ruleDeclarations(styles, ".num")).toContain("font-variant-numeric: tabular-nums");
  });

  it("draws its colours, radii and surfaces from the app's own theme", async () => {
    const styles = styleBlock(await (await landing()).text());

    expect(ruleDeclarations(styles, ".btn")).toContain("border-radius: var(--radius-btn)");
    expect(ruleDeclarations(styles, ".nav")).toContain("border-bottom: 1px solid var(--ash)");
    expect(ruleDeclarations(styles, ".band-paper")).toContain("background: var(--paper)");

    const body = ruleDeclarations(styles, "body");
    expect(body).toContain("font-size: 15px");
    expect(body).toContain("color: var(--charcoal)");
  });

  it("keeps every text colour readable against the surface it is painted on", async () => {
    const styles = styleBlock(await (await landing()).text());
    const pairs: ReadonlyArray<readonly [string, string, string]> = [
      ["ข้อความหลัก", "charcoal", "white"],
      ["คำโปรยและคำอธิบาย", "steel", "white"],
      ["คำกำกับและป้ายตัวเลข", "fog", "white"],
      ["คำโปรยบนและเลขลำดับขั้น", "blue", "white"],
      ["ป้ายบนปุ่มหลัก", "white", "ink"],
      ["หัวข้อและค่าที่สืบทอดสีหลักบนพื้น paper", "charcoal", "paper"],
      ["ป้ายในรายการเทคโนโลยีและหัวข้อเล็กบนพื้น paper", "fog", "paper"],
      ["คำอธิบายข้อตัดสินใจ", "steel", "paper"],
    ];
    const missingTokens: string[] = [];
    const belowAA: string[] = [];

    for (const [label, foreground, background] of pairs) {
      const foregroundHex = hexToken(styles, foreground);
      const backgroundHex = hexToken(styles, background);

      if (foregroundHex === "" || backgroundHex === "") {
        missingTokens.push(`${label}: --${foreground} หรือ --${background}`);
      } else if (contrastRatio(foregroundHex, backgroundHex) < 4.5) {
        belowAA.push(label);
      }
    }

    expect(missingTokens).toEqual([]);
    expect(belowAA).toEqual([]);
  });

  it("hides reveal sections only when scripting is on, and not at all under reduced motion", async () => {
    const html = await (await landing()).text();
    const styles = styleBlock(html);

    expect(html).toContain('document.documentElement.className = "js"');
    expect(ruleDeclarations(styles, "html.js .reveal:not(.in)")).toContain("opacity: 0");

    const reduced = styles.slice(styles.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain("html.js .reveal:not(.in)");
    expect(reduced).toContain("opacity: 1");
    expect(reduced).toContain("transform: none");
  });
});
