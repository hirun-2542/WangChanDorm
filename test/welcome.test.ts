import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { landingConfig } from "../src/worker/routes/welcome-config";
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
    expect(html).toContain('<img src="/welcome-media/hero-bill-create.webp" width="804" height="798"');
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

    expect(section).toContain('src="/welcome-media/bill-dashboard.webp" width="804" height="372"');
    expect(section).toContain('src="/welcome-media/bill-line-qr.webp" width="804" height="1684"');
    expect(section).toContain('src="/welcome-media/payment-status.webp" width="736" height="1974"');
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
    expect(footer).toContain("ทดลองระบบ");
  });

  it("renders no contact link while the deploy-time values are still blank", async () => {
    const html = await (await landing()).text();

    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("github.com");
  });

  it("references exactly the four page images, each with its intrinsic size", async () => {
    const html = await (await landing()).text();
    const sources = Array.from(html.matchAll(/<img [^>]*src="\/(welcome-media\/[^"]+)"/g), (match) => match[1]);

    expect(sources).toEqual([
      "welcome-media/hero-bill-create.webp",
      "welcome-media/bill-dashboard.webp",
      "welcome-media/bill-line-qr.webp",
      "welcome-media/payment-status.webp",
    ]);

    for (const tag of html.match(/<img [^>]*>/g) ?? []) {
      expect(tag).toMatch(/width="\d+"/);
      expect(tag).toMatch(/height="\d+"/);
      expect(tag).toMatch(/alt="[^"]{10,}"/);
    }
  });

  /**
   * หน้าเสิร์ฟได้โดยไม่มีเซสชันและไม่พึ่งฐานข้อมูล — เทสต์ในไฟล์นี้ไม่สร้างผู้ใช้
   * ห้อง หรือบิลเลย ทั้งไฟล์จึงพิสูจน์ข้อนี้อยู่แล้ว เทสต์นี้ล็อกเจตนานั้นไว้
   */
  it("serves the whole page with no session and an empty database", async () => {
    const count = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM rooms) + (SELECT COUNT(*) FROM tenants) AS n",
    ).first<{ n: number }>();

    expect(count?.n).toBe(0);

    const html = await (await landing()).text();
    expect(html).toContain("ทดลองระบบ");
    expect(html).toContain("ข้อตัดสินใจที่กำหนดรูปร่างระบบ");
  });

  it("keeps the nav button readable instead of letting the nav link colour win", async () => {
    const styles = styleBlock(await (await landing()).text());
    const html = await (await landing()).text();

    // ปุ่มใน nav ต้องไม่ถูก `.nav-links a` ทับสี (เคยทำให้เหลือ 2.53:1)
    const navRule = ruleDeclarations(styles, ".nav-links a:not(.btn)");
    expect(navRule).toContain("color: var(--steel)");
    expect(navRule).toContain("min-height: 44px");
    expect(ruleDeclarations(styles, ".nav-links a")).toBe("");

    expect(ruleDeclarations(styles, ".btn-primary")).toContain("color: var(--white)");

    // บน config ฐาน (DEMO_MODE=0) ปุ่มหลักเป็นสถานะปิด ไม่ใช่ลิงก์
    expect(html).toContain('<span class="btn btn-primary" role="link" aria-disabled="true"');
  });

  it("gives every interactive element a visible focus ring and a themed selection", async () => {
    const styles = styleBlock(await (await landing()).text());
    const tokens = hexToken(styles, "selection-bg");

    // ต้องตรงกับสไตล์ชีตของแอป (::selection กับ :focus-visible) ไม่ใช่ค่าที่คิดขึ้นใหม่
    // แอปใช้ #dbeaff กับพื้นหลัง selection และ #2563eb กับ focus ring
    expect(tokens).toBe("#dbeaff");
    expect(ruleDeclarations(styles, ".btn:focus-visible, a:focus-visible")).toContain("outline: 2px solid var(--blue)");
    expect(ruleDeclarations(styles, "::selection")).toContain("background: var(--selection-bg)");
    expect(styles).toContain("color-scheme: light");
    // พื้นผิวของเบราว์เซอร์เป็นของเราด้วย ไม่ปล่อยเป็นค่าเริ่มต้นของระบบ
    expect(styles).toContain("scrollbar-color: var(--scrollbar) transparent");
  });

  it("marks the hero as the high-priority image and leaves the rest lazy", async () => {
    const html = await (await landing()).text();
    const hero = html.match(/<img src="\/welcome-media\/hero-bill-create\.webp"[^>]*>/)?.[0] ?? "";

    expect(hero).toContain('fetchpriority="high"');
    expect(hero).toContain('decoding="async"');
    expect(hero).not.toContain('loading="lazy"');

    const gallery = html.slice(html.indexOf('id="screens"'), html.indexOf('id="build"'));
    expect(Array.from(gallery.matchAll(/loading="lazy"/g))).toHaveLength(3);
  });

  it("declares only the tokens it actually uses", async () => {
    const styles = styleBlock(await (await landing()).text());
    const declared = Array.from(styles.matchAll(/--([a-z-]+):/g), (match) => match[1]);
    const unused = declared.filter((name) => !styles.includes(`var(--${name})`));

    expect(unused).toEqual([]);
  });

  it("points the primary button at the deploy-time demo address once it is set", async () => {
    const original = landingConfig.demoEntryUrl;
    landingConfig.demoEntryUrl = "https://wangchan-demo.example.workers.dev";

    try {
      const html = await (await landing()).text();

      // สเปกกำหนดว่าปุ่มหลักต้องชี้ไปที่ที่อยู่เดโมที่ตั้งไว้จริง ไม่ใช่เส้นทางสำรอง
      expect(html).toContain('<a class="btn btn-primary" href="https://wangchan-demo.example.workers.dev">ทดลองระบบ</a>');
      expect(html).not.toContain('href="/api/demo/enter"');
    } finally {
      landingConfig.demoEntryUrl = original;
    }
  });

  it("fails the primary button safe when the deploy-time demo address is unset", async () => {
    const html = await (await landing()).text();

    // เทสต์รันบน config ฐานที่ DEMO_MODE=0 และ landingConfig.demoEntryUrl ว่าง
    // เส้นทางสำรองถูกปิดแบบ fail closed บน production ปุ่มจึงต้องไม่เป็นลิงก์
    expect(html).toContain('<span class="btn btn-primary" role="link" aria-disabled="true"');
    expect(html).not.toContain('href="/api/demo/enter"');

    const styles = styleBlock(html);
    expect(ruleDeclarations(styles, '.btn[aria-disabled="true"]')).toContain("color: var(--charcoal)");
    expect(ruleDeclarations(styles, '.btn[aria-disabled="true"]')).toContain("background: var(--silver)");
  });

  it("offers a jump link for every section a reviewer needs", async () => {
    const html = await (await landing()).text();

    // #build และ #process คือสองส่วนที่คนประเมินต้องการที่สุด และเคยเข้าถึงได้ด้วยการเลื่อนเท่านั้น
    expect(html).toContain('<a class="nav-jump" href="#demo">ดูสาธิต</a>');
    expect(html).toContain('<a class="nav-jump" href="#build">ข้อตัดสินใจ</a>');
    expect(html).toContain('<a class="nav-jump" href="#process">กระบวนการ</a>');

    // บนจอแคบ ลิงก์กระโดดต้องถูกซ่อน ไม่งั้นปุ่มหลักตกขอบจอ (390px เคยล้น 1px
    // และตัดคำเป็นสามบรรทัด) ต้องมี specificity เท่ากับ .nav-links a:not(.btn)
    const styles = styleBlock(html);
    const mobile = styles.slice(styles.indexOf("@media (max-width: 639px)"), styles.indexOf("@media (min-width: 640px)"));
    expect(mobile).toContain(".nav-links a.nav-jump");
    expect(mobile).toContain("display: none");

    // ปุ่มรองใน hero ต้องพาไปส่วน "เขียนยังไง" จริง ไม่ใช่ส่วนพิธีกรรมรายเดือน
    expect(html).toContain('<a class="btn btn-secondary" href="#build">ดูว่าเขียนยังไง</a>');
  });

  it("does not hide sections when the page is printed", async () => {
    const styles = styleBlock(await (await landing()).text());
    const print = styles.slice(styles.indexOf("@media print"));

    // ไม่มีการเลื่อนจอตอนพิมพ์ จึงไม่มีอะไร trigger IntersectionObserver
    expect(print).toContain("html.js .reveal:not(.in)");
    expect(print).toContain("opacity: 1");
    expect(print).toContain("transform: none");
  });

  it("bounds the width of every text block so no line runs to the screen edge", async () => {
    const styles = styleBlock(await (await landing()).text());

    // .note ใน .band เคยไม่มี max-width ทำให้ได้บรรทัดยาว ~168 ตัวอักษรบนจอกว้าง
    expect(ruleDeclarations(styles, ".band .note")).toContain("max-width: 62ch");
    expect(ruleDeclarations(styles, ".band h2 + p")).toContain("max-width: 62ch");
    expect(ruleDeclarations(styles, ".shot p")).toContain("max-width: 68ch");
  });

  it("renders a working demo link when the page is served by the demo worker", async () => {
    const demoEnv = env as unknown as { DEMO_MODE: string };
    demoEnv.DEMO_MODE = "1";

    try {
      const html = await (await landing()).text();
      const body = html.slice(html.indexOf("<body>"));

      expect(body).toContain('<a class="btn btn-primary" href="/api/demo/enter">ทดลองระบบ</a>');
      expect(body).not.toContain('aria-disabled="true"');
    } finally {
      demoEnv.DEMO_MODE = "0";
    }
  });

  /**
   * ภาพหน้าจอต้องอ่านออกที่สเกลที่หน้าเว็บเรนเดอร์จริง
   *
   * ภาพชุดแรก (ตั๋ว 09) เป็นภาพเต็มจอ 1510-2313px ที่แสดงเพียง 340-990px
   * ทำให้ตัวอักษรแอป 13px เหลือ 1.9-8.5px คือมองเห็นเป็นแถบเทา หลักฐานจึงไม่ถูกส่งมอบ
   * ตอนนี้ภาพเป็น crop จากจอแคบที่ถ่ายที่ DPR 2 (ตัวอักษรแอป 13px = 26 device px)
   * เทสต์นี้ล็อกความสัมพันธ์นั้นไว้: แสดงผลอย่างน้อย 42% ของความกว้างจริง
   */
  it("keeps every screenshot readable at the scale the page actually renders it", async () => {
    const html = await (await landing()).text();
    const imgs = Array.from(html.matchAll(/<img [^>]*src="\/welcome-media\/([^"]+)"[^>]*width="(\d+)"[^>]*height="(\d+)"/g));

    expect(imgs.length).toBe(4);

    for (const [, file, width] of imgs) {
      const natural = Number(width);

      // ด้านแคบสุดที่หน้าเว็บแสดงภาพคือ 340px (มือถือ 390 ลบ padding)
      const smallestDisplay = 340;
      const scale = smallestDisplay / natural;

      expect(scale, `${file} ถูกย่อเหลือ ${String(Math.round(scale * 100))}%`).toBeGreaterThanOrEqual(0.4);
    }
  });

  it("exposes every section as a landmark and quotes a real ticket instead of a repo path", async () => {
    const html = await (await landing()).text();

    // แต่ละส่วนมีหัวข้อของตัวเองและอ้างอิงถึงกัน จึงถูกเปิดเป็น landmark region
    for (const id of ["flow", "demo", "screens", "build", "process"]) {
      expect(html).toContain(`aria-labelledby="${id}-title"`);
      expect(html).toContain(`<h2 id="${id}-title">`);
    }

    // หลักฐานต้องอ่านได้บนหน้าเอง — ตราบใดที่ repo ยังไม่สาธารณะ path ในโปรเจค
    // ก็เปิดไม่ได้ การชี้ไปที่ path จึงไม่ใช่หลักฐาน
    const section = html.slice(html.indexOf('id="process"'), html.indexOf('class="footer"'));
    expect(section).toContain("ตัวอย่างตั๋วงานที่ใช้จริง");
    expect(section).not.toContain("docs/specs");
    expect(section).not.toContain(".scratch");
    expect(section).not.toContain("<code>");
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

  it("widens the decisions, the stages and the gallery with the screen", async () => {
    const styles = styleBlock(await (await landing()).text());
    const wide = styles.slice(styles.indexOf("@media (min-width: 960px)"));

    expect(ruleDeclarations(styles, ".shots")).toContain("display: grid");
    // แกลเลอรีเดิมเป็นคอลัมน์เดียวเพราะภาพชุดแรกมีความกว้างต่อความสูงต่างกันมาก
    // ภาพชุดใหม่ (ตั๋ว 09 rev. 2) เป็นภาพแนวตั้งจากจอแคบทั้งหมด จึงจับคู่สองคอลัมน์ได้
    // และทำให้ส่วนนี้สั้นลงครึ่งหนึ่งโดยไม่ต้องย่อภาพให้เล็กลงจนอ่านไม่ออก
    expect(ruleDeclarations(wide, ".shots")).toContain("1fr 1fr");
    expect(ruleDeclarations(wide, ".shots")).toContain("align-items: start");
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
      ["ปุ่มที่ยังกดไม่ได้", "charcoal", "silver"],
      ["ป้ายกำกับหัวข้อย่อยบนพื้น paper", "steel", "paper"],
      ["หัวข้อการ์ดข้อตัดสินใจ", "charcoal", "white"],
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
