import { Hono } from "hono";
import type { AppEnv } from "../lib/auth";

/**
 * หน้าแนะนำโปรเจคสำหรับคนที่มาดูผลงาน — หน้าสาธารณะหน้าที่สองต่อจากหน้า
 * ลงทะเบียนผู้เช่า จึงเรนเดอร์ HTML เองทั้งหมดโดยไม่โหลดบันเดิลของ SPA
 *
 * หน้านี้ไม่แตะ DB หรือ R2 และไม่มีเกตล็อกอิน จึงเสิร์ฟ HTML ล้วนที่ไม่มีทาง
 * รั่วข้อมูลของผู้เช่าออกจากตัวมันเอง
 *
 * โทเคนสีคัดจาก `@theme` ใน `src/client/styles.css` ห้ามคิดค่าสีใหม่ที่นี่
 *
 * สื่อของหน้าอยู่ที่ `/welcome-media/` ซึ่งเป็นพาธข้างหน้า ไม่ใช่พาธย่อยของหน้า
 * เพราะรายการใน `assets.run_worker_first` แบบไม่มี `*` จับพาธตรงตัว แต่ถ้าวันหนึ่ง
 * มีคนเปลี่ยนเป็น `/welcome*` (เช่นตอนเพิ่มหน้าอื่นใต้พาธนี้) ไฟล์ใต้ `/welcome/`
 * จะถูก worker รับก่อนแล้วตกไปที่ fallback ของ SPA ทันทีโดยไม่มีใครรู้
 *
 * สื่อทุกไฟล์ต้องถูกคัดเข้า `dist/client` ด้วย `npm run build` เท่านั้น —
 * การก็อปไฟล์ลง `dist/client` ตรง ๆ แล้วยิงขอจะได้ `index.html` กลับมา เพราะ
 * asset manifest ถูกสร้างตอน build ไม่ได้อ่านจากโฟลเดอร์สด ๆ
 */
const welcomeStyles = `
      :root {
        --ink: #0a0a0a;
        --charcoal: #171717;
        --steel: #525252;
        --fog: #6b6b6b;
        --silver: #a3a3a3;
        --ash: #e5e5e5;
        --paper: #f5f5f5;
        --white: #ffffff;
        --blue: #2563eb;
        --sapphire: #1e40af;
        --mint: #dcfce7;
        --green: #15803d;
        --amber-bg: #fff7e6;
        --amber-fg: #b45309;
        --line: #06c755;
        --radius-input: 6px;
        --radius-btn: 8px;
        --radius-card: 12px;
        --radius-panel: 16px;
        --radius-pill: 9999px;
        --shadow-subtle: rgba(0, 0, 0, 0.05) 0 1px 2px;
        --shadow-sm: rgba(0, 0, 0, 0.1) 0 4px 6px -1px, rgba(0, 0, 0, 0.1) 0 2px 4px -2px;
        --monogram: conic-gradient(from -81deg, #ff0000, #eab308 99deg, #5cff80 162deg, #00fff9 216deg, #3a8bfd 288deg, #855afc);
        --ease: cubic-bezier(0.16, 1, 0.3, 1);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        background: var(--white);
        color: var(--charcoal);
        font-family: Inter, "Noto Sans Thai", ui-sans-serif, system-ui, sans-serif;
        font-size: 15px;
        line-height: 1.7;
        -webkit-text-size-adjust: 100%;
      }

      .container {
        width: 100%;
        max-width: 1120px;
        margin: 0 auto;
        padding: 0 24px;
      }

      h1, h2, h3 { margin: 0; letter-spacing: -0.02em; font-weight: 600; }
      h1 { font-size: clamp(32px, 4.2vw, 52px); line-height: 1.15; }
      h2 { font-size: 28px; line-height: 1.3; }
      p { margin: 0; }
      a { color: inherit; }

      .lede { font-size: 18px; line-height: 1.6; color: var(--steel); }
      .note { font-size: 12px; color: var(--fog); }
      .num { font-variant-numeric: tabular-nums; }

      .btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 0 20px;
        border: 1px solid transparent;
        border-radius: var(--radius-btn);
        font: inherit;
        font-weight: 500;
        text-decoration: none;
        cursor: pointer;
      }
      .btn-primary { background: var(--ink); color: var(--white); }
      .btn-secondary { background: var(--white); border-color: var(--ash); color: var(--charcoal); }

      .mark {
        display: grid;
        width: 28px;
        height: 28px;
        flex: none;
        padding: 2px;
        place-items: center;
        border-radius: 9px;
        background: var(--monogram);
      }
      .mark-inner {
        display: grid;
        width: 100%;
        height: 100%;
        place-items: center;
        border-radius: 7px;
        background: var(--white);
        color: var(--charcoal);
        font-size: 11px;
        font-weight: 600;
        line-height: 1;
      }

      .nav { border-bottom: 1px solid var(--ash); }
      .nav-inner { display: flex; align-items: center; gap: 16px; min-height: 64px; }
      .brand { display: flex; align-items: center; gap: 10px; font-weight: 600; text-decoration: none; }
      .nav-links { display: flex; align-items: center; gap: 20px; margin-left: auto; }
      .nav-links a { text-decoration: none; color: var(--steel); font-size: 14px; }
      .nav-links a:hover { color: var(--charcoal); }

      .band { padding: 88px 0; }
      .band-paper { background: var(--paper); }
      .band h2 + p { margin-top: 12px; max-width: 60ch; }
      .band .note { margin-top: 12px; }

      .hero-grid { display: grid; gap: 40px; align-items: center; }
      .kicker { font-size: 12px; font-weight: 500; letter-spacing: 0.08em; color: var(--blue); }
      .hero h1 { margin-top: 12px; }
      .hero .lede { margin-top: 16px; max-width: 46ch; }
      .hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }

      .stats { display: flex; flex-wrap: wrap; gap: 32px; margin: 36px 0 0; padding-top: 20px; border-top: 1px solid var(--ash); }
      .stat { margin: 0; }
      .stat dt, .stat dd { margin: 0; }
      .stat-value { font-size: 22px; font-weight: 600; }
      .stat-label { font-size: 12px; color: var(--fog); }

      .frame { overflow: hidden; border: 1px solid var(--ash); border-radius: var(--radius-card); background: var(--white); box-shadow: var(--shadow-sm); }
      .frame-bar { display: flex; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--ash); background: var(--paper); }
      .frame-dot { width: 8px; height: 8px; border-radius: var(--radius-pill); background: var(--silver); }
      .frame img, .frame video { display: block; width: 100%; height: auto; }

      .subhead { font-size: 13px; font-weight: 500; letter-spacing: 0.04em; color: var(--fog); }

      .steps { display: grid; gap: 1px; margin: 20px 0 0; padding: 0; overflow: hidden; border: 1px solid var(--ash); border-radius: var(--radius-card); background: var(--ash); list-style: none; }
      .step { padding: 20px; background: var(--white); }
      .step-num { font-size: 13px; font-weight: 700; color: var(--blue); }
      .step h3 { margin-top: 10px; font-size: 15px; }
      .step h3 + p { margin-top: 6px; font-size: 13px; color: var(--steel); }

      .cards { display: grid; gap: 20px; margin-top: 28px; }
      .card { padding: 24px; border: 1px solid var(--ash); border-radius: var(--radius-card); background: var(--white); }
      .card h3 { font-size: 16px; }
      .card p { margin-top: 8px; font-size: 14px; color: var(--steel); }

      .build-grid { display: grid; gap: 40px; margin-top: 28px; }
      .tech { margin: 0; }
      .tech-row { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 16px; padding: 12px 0; border-top: 1px solid var(--ash); }
      .tech-row:last-child { border-bottom: 1px solid var(--ash); }
      .tech-row dt { font-size: 13px; color: var(--fog); }
      .tech-row dd { margin: 0; font-size: 14px; font-weight: 500; }
      .decisions { margin-top: 18px; }
      .decision + .decision { margin-top: 18px; }
      .decision h3 { font-size: 14px; }
      .decision p { margin-top: 4px; font-size: 13px; color: var(--steel); }

      .footer { border-top: 1px solid var(--ash); }
      .footer .container { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; padding-top: 32px; padding-bottom: 32px; }
      .footer .note { margin: 0; }
      .footer .btn { margin-left: auto; }

      .reveal { transition: opacity 400ms var(--ease), transform 400ms var(--ease); }
      html.js .reveal:not(.in) { opacity: 0; transform: translateY(12px); }

      @media (max-width: 639px) {
        .band { padding: 56px 0; }
      }

      @media (min-width: 640px) {
        .container { padding: 0 40px; }
        .steps { grid-template-columns: repeat(2, 1fr); }
        .step:last-child { grid-column: 1 / -1; }
      }

      @media (min-width: 960px) {
        .container { padding: 0 64px; }
        .hero-grid { grid-template-columns: 1fr 1fr; gap: 56px; }
        .steps { grid-template-columns: repeat(5, 1fr); }
        .step:last-child { grid-column: auto; }
        .cards { grid-template-columns: repeat(3, 1fr); }
        .build-grid { grid-template-columns: 1fr 1fr; gap: 56px; }
      }

      @media (prefers-reduced-motion: reduce) {
        .reveal { transition: none; }
        html.js .reveal:not(.in) { opacity: 1; transform: none; }
      }
`;

const pageTitle = "หอพักวังจันทร์ — แนะนำโปรเจค";
const pageDescription =
  "ระบบจัดการหอพักขนาดเล็ก สร้างบิลทั้งหอจากการกรอกมิเตอร์ครั้งเดียว ส่งเข้า LINE พร้อม QR พร้อมเพย์ และปิดบิลเองเมื่อสลิปยอดตรง";

function navSection(): string {
  return `<header class="nav">
      <div class="container nav-inner">
        <a class="brand" href="/welcome"><span class="mark" aria-hidden="true"><span class="mark-inner">วจ</span></span>หอพักวังจันทร์</a>
        <nav class="nav-links" aria-label="หัวข้อในหน้านี้">
          <a href="#demo">ดูสาธิต</a>
          <a href="#build">สถาปัตยกรรม</a>
          <a class="btn btn-primary" href="/">เปิดระบบ</a>
        </nav>
      </div>
    </header>`;
}

function heroSection(): string {
  return `<section class="band hero">
      <div class="container hero-grid">
        <div>
          <p class="kicker">โปรเจคจัดการหอพักขนาดเล็ก</p>
          <h1>จากสมุดจด<br />สู่บิลที่ส่งเองทั้งหอ</h1>
          <p class="lede">หอไม่เกิน 20 ห้อง กรอกเลขมิเตอร์ครั้งเดียวแล้วออกบิลได้ทั้งหอ ส่งเข้า LINE พร้อม QR พร้อมเพย์ยอดตรง และปิดบิลให้เองเมื่อสลิปยอดถูกต้อง</p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="#demo">ดูวิดีโอสาธิต</a>
            <a class="btn btn-secondary" href="#build">ดูว่าสร้างด้วยอะไร</a>
          </div>
          <dl class="stats">
            <div class="stat"><dt class="stat-value num">20</dt><dd class="stat-label">ห้องสูงสุดต่อหอ</dd></div>
            <div class="stat"><dt class="stat-value num">1</dt><dd class="stat-label">หน้าจอต่อรอบบิล</dd></div>
            <div class="stat"><dt class="stat-value num">0</dt><dd class="stat-label">แอปที่ผู้เช่าต้องติดตั้ง</dd></div>
          </dl>
        </div>
        <div>
          <div class="frame">
            <div class="frame-bar" aria-hidden="true"><span class="frame-dot"></span><span class="frame-dot"></span><span class="frame-dot"></span></div>
            <img src="/welcome-media/hero-bills.webp" width="1510" height="1045" alt="หน้าสร้างบิลที่กรอกเลขมิเตอร์ไปแล้วสามห้อง ยอดค่าน้ำ ค่าไฟ และยอดรวมคำนวณให้ทันที" />
          </div>
          <p class="note">ภาพหน้าจอจากข้อมูลตัวอย่าง</p>
        </div>
      </div>
    </section>`;
}

function demoSection(): string {
  return `<section id="demo" class="band reveal">
      <div class="container">
        <h2>ดูรอบบิลจริงหนึ่งรอบ</h2>
        <p class="lede">คลิปเดียวจบตั้งแต่กรอกมิเตอร์ จนบิลไปถึงแชทของผู้เช่า</p>
        <div class="frame">
          <div class="frame-bar" aria-hidden="true"><span class="frame-dot"></span><span class="frame-dot"></span><span class="frame-dot"></span></div>
          <video controls muted playsinline preload="none" poster="/welcome-media/poster.jpg" width="1280" height="800">
            <source src="/welcome-media/demo.webm" type="video/webm" />
            <source src="/welcome-media/demo.mp4" type="video/mp4" />
            เบราว์เซอร์นี้เล่นวิดีโอไม่ได้ เปิดไฟล์คลิปได้ที่ <a href="/welcome-media/demo.mp4">demo.mp4</a>
          </video>
        </div>
        <p class="note">ข้อมูลห้อง ผู้เช่า และยอดเงินในคลิปเป็นข้อมูลตัวอย่างทั้งหมด</p>
      </div>
    </section>`;
}

const steps: ReadonlyArray<readonly [string, string]> = [
  ["อ่านมิเตอร์", "เดินอ่านเลขน้ำและไฟทีละห้อง จดลงกระดาษเหมือนเดิม"],
  ["กรอกหน้าเดียว", "พิมพ์เลขลงตารางเดียวทั้งหอ เห็นยอดของทุกห้องขยับทันที"],
  ["สร้างบิลทั้งหอ", "กดครั้งเดียวได้บิลทุกห้อง ราคาถูกตรึงไว้ ณ วันสร้าง"],
  ["ส่งเข้า LINE", "บิลพร้อม QR พร้อมเพย์ยอดตรงถึงแชทที่ผู้เช่าใช้อยู่แล้ว"],
  ["สลิปเข้า ปิดบิล", "ยอดตรงปิดบิลให้เอง ยอดไม่ตรงเข้าคิวรอเจ้าของตรวจ"],
];

const duties: ReadonlyArray<readonly [string, string]> = [
  [
    "บิลรายเดือน",
    "หนึ่งบิลต่อห้องต่อเดือน รวมค่าห้อง ค่าน้ำ ค่าไฟ และค่าใช้จ่ายประจำของหอ ค่าไฟเลือกได้ทั้งแบบคิดตามมิเตอร์และแบบเหมาจ่ายรายห้อง",
  ],
  [
    "ช่องทาง LINE",
    "ผู้เช่าเชื่อมบัญชีด้วยการพิมพ์เลขห้องให้บอท จากนั้นรับบิล สแกนจ่าย และส่งสลิปได้ในแชทเดิม ไม่ต้องสมัครบัญชีกับระบบ",
  ],
  [
    "ตรวจสลิป",
    "สลิปที่ส่งเข้ามาถูกเก็บไว้และส่งตรวจกับบริการภายนอก ยอดตรงระบบปิดบิลเอง ยอดไม่ตรงหรืออ่านไม่ออกจะเข้าคิวให้เจ้าของตัดสินใจ",
  ],
];

const stack: ReadonlyArray<readonly [string, string]> = [
  ["รันบน", "Cloudflare Workers"],
  ["ฐานข้อมูล", "Cloudflare D1 (SQLite)"],
  ["ไฟล์สลิป", "Cloudflare R2"],
  ["เราเตอร์ฝั่งเซิร์ฟเวอร์", "Hono"],
  ["หน้าเว็บ", "React 19 + Vite + Tailwind CSS 4"],
  ["ใบแจ้งหนี้ PDF", "pdf-lib"],
  ["QR พร้อมเพย์", "uqr"],
  ["แชทบอท", "LINE Messaging API"],
  ["ทดสอบ", "Vitest บน workerd"],
];

const decisions: ReadonlyArray<readonly [string, string]> = [
  ["ราคาถูกตรึงไว้ในบิล", "บิลเก็บราคาไว้ ณ วันสร้าง การแก้ค่าตั้งต้นภายหลังจึงไม่ย้อนไปเปลี่ยนบิลที่ออกไปแล้ว"],
  ["ไม่มีงานตั้งเวลา", "ไม่มี cron ทุกอย่างเกิดจากคำขอจริง ระบบจึงไม่มีอะไรให้ดูแลเบื้องหลัง"],
  ["ผู้เช่าไม่มีบัญชี", "ไม่มีหน้าจอและไม่มีรหัสผ่านฝั่งผู้เช่า LINE เป็นช่องทางเดียว"],
  ["เข้าระบบด้วย Google เท่านั้น", "ไม่มีรหัสผ่านเก็บอยู่ในระบบเลย"],
];

function flowSection(): string {
  const cards = steps
    .map(
      ([title, detail], index) =>
        `<li class="step"><p class="step-num num" aria-hidden="true">${String(index + 1).padStart(2, "0")}</p><h3>${title}</h3><p>${detail}</p></li>`,
    )
    .join("\n        ");

  return `<section id="flow" class="band band-paper reveal">
      <div class="container">
        <h2 class="subhead">ห้าขั้นตอนของรอบบิล</h2>
        <ol class="steps">
        ${cards}
        </ol>
      </div>
    </section>`;
}

function whatSection(): string {
  const cards = duties
    .map(([title, detail]) => `<article class="card"><h3>${title}</h3><p>${detail}</p></article>`)
    .join("\n        ");

  return `<section id="what" class="band reveal">
      <div class="container">
        <h2>ระบบดูแลอะไรให้บ้าง</h2>
        <div class="cards">
        ${cards}
        </div>
      </div>
    </section>`;
}

function buildSection(): string {
  const rows = stack
    .map(([label, value]) => `<div class="tech-row"><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("\n        ");

  const items = decisions
    .map(([title, detail]) => `<div class="decision"><h3>${title}</h3><p>${detail}</p></div>`)
    .join("\n          ");

  return `<section id="build" class="band band-paper reveal">
      <div class="container">
        <h2>สร้างด้วยอะไร</h2>
        <div class="build-grid">
          <dl class="tech">
        ${rows}
          </dl>
          <div>
            <p class="subhead">ข้อตัดสินใจที่กำหนดรูปร่างระบบ</p>
            <div class="decisions">
          ${items}
            </div>
          </div>
        </div>
      </div>
    </section>`;
}

function footerSection(): string {
  return `<footer class="footer">
      <div class="container">
        <span class="brand"><span class="mark" aria-hidden="true"><span class="mark-inner">วจ</span></span>หอพักวังจันทร์</span>
        <p class="note">ข้อมูลทั้งหมดที่แสดงในหน้านี้เป็นข้อมูลตัวอย่าง</p>
        <a class="btn btn-primary" href="/">เปิดระบบ</a>
      </div>
    </footer>`;
}

const revealScript = `
      (function () {
        var targets = document.querySelectorAll(".reveal");
        var reveal = function (element) { element.classList.add("in"); };

        if (!("IntersectionObserver" in window)) {
          Array.prototype.forEach.call(targets, reveal);
          return;
        }

        var observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              reveal(entry.target);
              observer.unobserve(entry.target);
            }
          });
        });

        Array.prototype.forEach.call(targets, function (target) { observer.observe(target); });

        /**
         * กันกรณีกระโดดข้าม: การเลื่อนแบบกระโดดไกล (กดสมอ หรือปัดเร็วมาก)
         * ทำให้บางหัวข้อไม่เคย intersect เลยและค้างซ่อนอยู่ ทั้งที่ผู้ใช้อยู่ต่ำกว่าแล้ว
         * ตัวนี้จึงเปิดให้หัวข้อที่อยู่เหนือจอไปแล้วโดยไม่ต้องรออนิเมชัน
         */
        var backstop = function () {
          var hidden = 0;

          Array.prototype.forEach.call(targets, function (target) {
            if (target.classList.contains("in")) {
              return;
            }

            if (target.getBoundingClientRect().bottom < 0) {
              reveal(target);
            } else {
              hidden += 1;
            }
          });

          if (hidden === 0) {
            window.removeEventListener("scroll", backstop);
          }
        };

        window.addEventListener("scroll", backstop, { passive: true });
      })();
`;

/**
 * เรนเดอร์หน้าทั้งหน้าเป็นสตริงเดียว
 *
 * `origin` รับมาจากคำขอเพื่อให้ URL ของภาพที่ใช้แชร์เป็นแบบเต็ม (og:image
 * ต้องเป็น URL เต็ม ตัว crawler ของ LINE ไม่แก้ URL แบบ نسبให้) — ฟังก์ชันยัง
 * บริสุทธิ์และเรียกตรงในเทสได้ด้วย origin คงที่
 */
export function renderWelcomePage(origin: string): string {
  return `<!doctype html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${pageTitle}</title>
    <meta name="description" content="${pageDescription}" />
    <meta property="og:title" content="${pageTitle}" />
    <meta property="og:description" content="${pageDescription}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${origin}/welcome" />
    <meta property="og:image" content="${origin}/welcome-media/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Noto+Sans+Thai:wght@400;500;600&display=swap" rel="stylesheet" />
    <script>document.documentElement.className = "js";</script>
    <style>${welcomeStyles}</style>
  </head>
  <body>
    ${navSection()}
    <main>
      ${heroSection()}
      ${demoSection()}
      ${flowSection()}
      ${whatSection()}
      ${buildSection()}
    </main>
    ${footerSection()}
    <script>${revealScript}</script>
  </body>
</html>
`;
}

const welcomePage = new Hono<AppEnv>();

welcomePage.get("/", (c) => c.html(renderWelcomePage(new URL(c.req.url).origin)));

export default welcomePage;
