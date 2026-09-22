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
});

describe("GET /welcome composition", () => {
  it("stacks the hero on narrow screens and splits it in two from 960px up", async () => {
    const styles = styleBlock(await (await landing()).text());
    const wide = styles.slice(styles.indexOf("@media (min-width: 960px)"));

    expect(ruleDeclarations(styles, ".hero-grid")).toContain("display: grid");
    expect(ruleDeclarations(wide, ".hero-grid")).toContain("grid-template-columns: 1fr 1fr");
    expect(ruleDeclarations(styles, ".btn")).toContain("min-height: 44px");
  });

  it("draws its colours, radii and surfaces from the app's own theme", async () => {
    const styles = styleBlock(await (await landing()).text());

    expect(ruleDeclarations(styles, ".btn")).toContain("border-radius: var(--radius-btn)");
    expect(ruleDeclarations(styles, ".nav")).toContain("border-bottom: 1px solid var(--ash)");
    expect(ruleDeclarations(styles, ".band-paper")).toContain("background: var(--paper)");

    const body = ruleDeclarations(styles, "body");
    expect(body).toContain("font-size: 15px");
    expect(body).toContain("color: var(--charcoal)");

    const text = hexToken(styles, "charcoal");
    const background = hexToken(styles, "white");
    expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(4.5);
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
