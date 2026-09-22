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

  it("opens the demo from the primary button and never says เปิดระบบ", async () => {
    const html = await (await landing()).text();

    expect(html).toContain('href="/api/demo/enter"');
    expect(html).toContain("ทดลองระบบ");
    expect(html).not.toContain("เปิดระบบ");
  });

  it("points every in-page link at a section that exists", async () => {
    const html = await (await landing()).text();
    const targets = Array.from(html.matchAll(/href="#([^"]+)"/g), (match) => match[1]);

    expect(targets.length).toBeGreaterThan(0);

    for (const target of targets) {
      expect(html).toContain(`id="${target}"`);
    }
  });

  it("leads with the claim and the first real screen, and carries no number band", async () => {
    const html = await (await landing()).text();

    expect(html).toContain("จากสมุดจด");
    expect(html).toContain("สู่บิลที่ส่งเองทั้งหอ");
    expect(html).toContain('<img src="/welcome-media/hero-bill-create.webp" width="1510" height="1045"');
    expect(html).not.toContain("ห้องสูงสุดต่อหอ");
    expect(html).not.toContain('class="stats"');
  });

  it("has no video element at all", async () => {
    const html = await (await landing()).text();

    expect(html).not.toContain("<video");
    expect(html).not.toContain("welcome-media/demo.mp4");
    expect(html).not.toContain("welcome-media/demo.webm");
    expect(html).not.toContain("welcome-media/poster.jpg");
  });

  it("tells the visitor what the demo is, what is off and that it is shared", async () => {
    const html = await (await landing()).text();
    const section = html.slice(html.indexOf('id="demo"'));

    expect(section).toContain("สิ่งที่ปิดไว้ในโหมดตัวอย่าง");
    expect(section).toContain("ไม่ส่งข้อความ LINE จริงถึงใคร");
    expect(section).toContain("ไม่เรียกบริการตรวจสลิปที่คิดค่าใช้จ่ายต่อครั้ง");
    expect(section).toContain("ไม่ผูก LINE ด้วยรหัสของเจ้าของหอ");
    expect(section).toContain("เดโมนี้ใช้ร่วมกัน");
    expect(section).toContain("ถูกรีเซ็ตกลับเป็นชุดตั้งต้นได้ตลอดเวลา");
    expect(section).not.toContain("รับประกัน");
  });

  it("labels everything on the page as sample data", async () => {
    const html = await (await landing()).text();

    expect(html).toContain("ภาพหน้าจอจากข้อมูลตัวอย่าง");
    expect(html).toContain("ข้อมูลทั้งหมดที่แสดงในหน้านี้เป็นข้อมูลตัวอย่าง");
    expect(html).toContain("ไม่ใช่ข้อมูลผู้เช่าจริงของหอใด");
  });

  it("keeps the five-step ritual as the story spine", async () => {
    const html = await (await landing()).text();
    const section = html.slice(html.indexOf('id="flow"'), html.indexOf('id="demo"'));
    const numbers = Array.from(section.matchAll(/class="step-num num"[^>]*>(\d\d)</g), (match) => match[1]);

    expect(numbers).toEqual(["01", "02", "03", "04", "05"]);

    for (const title of ["อ่านมิเตอร์", "กรอกหน้าเดียว", "สร้างบิลทั้งหอ", "ส่งเข้า LINE", "สลิปเข้า ปิดบิล"]) {
      expect(section).toContain(`<h3>${title}</h3>`);
    }

    expect(section).not.toContain("<img");
  });

  it("keeps the sections in the order the page reads them", async () => {
    const html = await (await landing()).text();
    const order = ['id="flow"', 'id="demo"', 'id="screens"', 'id="build"', 'id="process"', 'class="footer"'].map(
      (marker) => html.indexOf(marker),
    );

    expect(order.every((index) => index > 0)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it("shows three real screens with intrinsic sizes and never repeats the hero image", async () => {
    const html = await (await landing()).text();
    const section = html.slice(html.indexOf('id="screens"'), html.indexOf('id="build"'));

    expect(section).toContain('src="/welcome-media/bill-dashboard.webp" width="1510" height="1133"');
    expect(section).toContain('src="/welcome-media/bill-line-qr.webp" width="2371" height="980"');
    expect(section).toContain('src="/welcome-media/payment-status.webp" width="1510" height="1290"');
    expect(section).toContain("<h3>แดชบอร์ดรายเดือน</h3>");
    expect(section).toContain("<h3>บิลที่ผู้เช่าได้รับ</h3>");
    expect(section).toContain("<h3>สถานะการชำระและคิวรอตรวจ</h3>");
    expect(section).not.toContain("hero-bill-create.webp");
  });

  it("frames each engineering decision as problem, decision and consequence", async () => {
    const html = await (await landing()).text();
    const section = html.slice(html.indexOf('id="build"'), html.indexOf('id="process"'));

    for (const title of [
      "ผู้เช่าไม่มีบัญชี",
      "ราคาถูกตรึงไว้ในบิล",
      "ปิดบิลเองเมื่อยอดตรงเป๊ะ",
      "ไม่มีงานตั้งเวลา",
    ]) {
      expect(section).toContain(`<h3>${title}</h3>`);
    }

    // สี่เรื่อง สามหัวข้อเท่ากันทุกเรื่อง = 12 คู่
    expect(Array.from(section.matchAll(/<dt>ปัญหา<\/dt>/g))).toHaveLength(4);
    expect(Array.from(section.matchAll(/<dt>ตัดสินใจ<\/dt>/g))).toHaveLength(4);
    expect(Array.from(section.matchAll(/<dt>ผลที่ตามมา<\/dt>/g))).toHaveLength(4);

    // ข้อเสียที่ยอมรับต้องอยู่บนหน้าจริง ไม่ใช่ซ่อนไว้
    expect(section).toContain("ยอมรับความเสี่ยงนี้");
  });

  it("describes the AI-assisted process as Plan, Build, Verify with the real tools", async () => {
    const html = await (await landing()).text();
    const section = html.slice(html.indexOf('id="process"'), html.indexOf('class="footer"'));

    expect(section).toContain("<h3>Plan</h3>");
    expect(section).toContain("<h3>Build</h3>");
    expect(section).toContain("<h3>Verify</h3>");
    expect(section).toContain("ChatGPT · Claude");
    expect(section).toContain("Codex · Claude Code");
    expect(section).toContain("ชุดเทส · การตรวจด้วยตาเปล่า");
  });

  it("closes with the brand, the sample-data note and the way into the demo", async () => {
    const html = await (await landing()).text();
    const footer = html.slice(html.indexOf('class="footer"'));

    expect(footer).toContain("วจ");
    expect(footer).toContain("หอพักวังจันทร์");
    expect(footer).toContain("ข้อมูลทั้งหมดที่แสดงในหน้านี้เป็นข้อมูลตัวอย่าง");
    expect(footer).toContain('href="/api/demo/enter"');
  });

  it("renders no contact link while the deploy-time values are still blank", async () => {
    const html = await (await landing()).text();

    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("github.com");
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

  it("lays the steps out in columns that widen with the screen", async () => {
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
    expect(ruleDeclarations(wide, ".demo-grid")).toContain("1fr 1fr");
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

  it("widens the gallery, the decisions and the stages with the screen", async () => {
    const styles = styleBlock(await (await landing()).text());
    const wide = styles.slice(styles.indexOf("@media (min-width: 960px)"));

    expect(ruleDeclarations(styles, ".shots")).toContain("display: grid");
    expect(ruleDeclarations(wide, ".shots")).toContain("1fr 1fr");
    expect(ruleDeclarations(wide, ".decisions")).toContain("1fr 1fr");
    expect(ruleDeclarations(wide, ".stages")).toContain("repeat(3, 1fr)");
    expect(ruleDeclarations(styles, ".stages")).toContain("background: var(--ash)");
    expect(ruleDeclarations(styles, ".decision dd")).toContain("color: var(--steel)");
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
      ["คำอธิบายใต้ภาพในส่วน Screenshots", "steel", "paper"],
      ["หัวข้อ ปัญหา/ตัดสินใจ/ผลที่ตามมา", "fog", "white"],
      ["คำอธิบายข้อตัดสินใจบนการ์ด", "steel", "white"],
      ["ชื่อเครื่องมือในแต่ละขั้นของกระบวนการ", "charcoal", "white"],
      ["เลขลำดับขั้นของกระบวนการ", "blue", "white"],
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
