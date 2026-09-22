import { Hono } from "hono";
import type { AppEnv } from "../lib/auth";
import { demoEntryHref, landingConfig } from "./welcome-config";

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
      .band h2 + p { margin-top: 12px; max-width: 62ch; }
      .band .note { margin-top: 12px; }

      .hero-grid { display: grid; gap: 40px; align-items: center; }
      .kicker { font-size: 12px; font-weight: 500; letter-spacing: 0.08em; color: var(--blue); }
      .hero h1 { margin-top: 12px; }
      .hero .lede { margin-top: 16px; max-width: 46ch; }
      .hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }

      .frame { overflow: hidden; border: 1px solid var(--ash); border-radius: var(--radius-card); background: var(--white); box-shadow: var(--shadow-sm); }
      .frame-bar { display: flex; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--ash); background: var(--paper); }
      .frame-dot { width: 8px; height: 8px; border-radius: var(--radius-pill); background: var(--silver); }
      .frame img { display: block; width: 100%; height: auto; }

      .subhead { font-size: 13px; font-weight: 500; letter-spacing: 0.04em; color: var(--fog); }

      .steps { display: grid; gap: 1px; margin: 20px 0 0; padding: 0; overflow: hidden; border: 1px solid var(--ash); border-radius: var(--radius-card); background: var(--ash); list-style: none; }
      .step { padding: 20px; background: var(--white); }
      .step-num { font-size: 13px; font-weight: 700; color: var(--blue); }
      .step h3 { margin-top: 10px; font-size: 15px; }
      .step h3 + p { margin-top: 6px; font-size: 13px; color: var(--steel); }

      .demo-grid { display: grid; gap: 40px; margin-top: 28px; align-items: start; }
      .demo-panel { padding: 28px; border: 1px solid var(--ash); border-radius: var(--radius-panel); background: var(--white); }
      .demo-panel h3 { font-size: 15px; }
      .demo-panel ul { margin: 12px 0 0; padding-left: 20px; }
      .demo-panel li { font-size: 14px; color: var(--steel); }
      .demo-panel li + li { margin-top: 6px; }
      .demo-panel .btn { margin-top: 20px; width: 100%; }

      .closure { margin-top: 20px; padding: 20px 24px; border: 1px solid var(--ash); border-radius: var(--radius-card); background: var(--paper); }
      .closure h3 { font-size: 14px; }
      .closure p { margin-top: 6px; font-size: 13px; color: var(--steel); }
      .closure ul { margin: 10px 0 0; padding-left: 20px; }
      .closure li { font-size: 13px; color: var(--steel); }
      .closure li + li { margin-top: 4px; }

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
        .demo-grid { grid-template-columns: 1fr 1fr; gap: 56px; }
      }

      @media (prefers-reduced-motion: reduce) {
        .reveal { transition: none; }
        html.js .reveal:not(.in) { opacity: 1; transform: none; }
      }
`;

const pageTitle = "หอพักวังจันทร์ — แนะนำโปรเจค";
const pageDescription =
  "ระบบจัดการหอพักขนาดเล็ก สร้างบิลทั้งหอจากการกรอกมิเตอร์ครั้งเดียว ส่งเข้า LINE พร้อม QR พร้อมเพย์ และปิดบิลเองเมื่อสลิปยอดตรง พร้อมเดโมสาธารณะให้ลองเอง";

function primaryCta(): string {
  return `<a class="btn btn-primary" href="${demoEntryHref(landingConfig)}">ทดลองระบบ</a>`;
}

function navSection(): string {
  return `<header class="nav">
      <div class="container nav-inner">
        <a class="brand" href="/welcome"><span class="mark" aria-hidden="true"><span class="mark-inner">วจ</span></span>หอพักวังจันทร์</a>
        <nav class="nav-links" aria-label="หัวข้อในหน้านี้">
          <a href="#demo">ดูสาธิต</a>
          ${primaryCta()}
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
            ${primaryCta()}
            <a class="btn btn-secondary" href="#flow">ดูว่าเขียนยังไง</a>
          </div>
        </div>
        <div>
          <div class="frame">
            <div class="frame-bar" aria-hidden="true"><span class="frame-dot"></span><span class="frame-dot"></span><span class="frame-dot"></span></div>
            <img src="/welcome-media/hero-bill-create.webp" width="1510" height="1045" alt="หน้าสร้างบิลที่กรอกเลขมิเตอร์ไปแล้วสามห้อง ยอดค่าน้ำ ค่าไฟ และยอดรวมคำนวณให้ทันที" />
          </div>
          <p class="note">ภาพหน้าจอจากข้อมูลตัวอย่าง</p>
        </div>
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

function contextSection(): string {
  const cards = steps
    .map(
      ([title, detail], index) =>
        `<li class="step"><p class="step-num num" aria-hidden="true">${String(index + 1).padStart(2, "0")}</p><h3>${title}</h3><p>${detail}</p></li>`,
    )
    .join("\n        ");

  return `<section id="flow" class="band band-paper reveal">
      <div class="container">
        <h2>หอเล็กที่เจ้าของคนเดียวทำทุกอย่างเอง</h2>
        <p>หอขนาดไม่เกิน 20 ห้อง ไม่มีพนักงานประจำ และไม่มีระบบเดิมให้ต่อ เจ้าของหอเดินอ่านมิเตอร์เอง จดใส่กระดาษ แล้วกลับมาเปิดโปรแกรมเพื่อออกบิล ส่งให้ผู้เช่า และตามเก็บเงิน ทุกเดือนด้วยมือคนเดียว ระบบนี้ออกแบบจากงานนั้น — งานที่ทำซ้ำทุกเดือนและไม่มีใครช่วยแบ่งเบา</p>
        <p class="subhead" style="margin-top:28px">ห้าขั้นตอนของรอบบิล</p>
        <ol class="steps">
        ${cards}
        </ol>
      </div>
    </section>`;
}

function demoSection(): string {
  return `<section id="demo" class="band reveal">
      <div class="container">
        <h2>ลองระบบจริงด้วยมือตัวเอง</h2>
        <p class="lede">กดปุ่มเดียวเข้าไปได้ทันที ไม่ต้องมีบัญชี Google และแก้ข้อมูลได้จริงทุกหน้า เพราะปุ่มที่กดแล้วไม่เกิดอะไรไม่ได้บอกอะไรเกี่ยวกับงานชิ้นนี้</p>

        <div class="demo-grid">
          <div class="demo-panel">
            <h3>สิ่งที่คุณจะเจอเมื่อเข้าไป</h3>
            <ul>
              <li>แดชบอร์ดรายรับของเดือนก่อนหน้า พร้อมยอดค้างชำระและห้องว่าง</li>
              <li>บิลสองเดือนย้อนหลัง ครอบคลุมทั้งจ่ายแล้ว ยังไม่จ่าย และสลิปรอตรวจ</li>
              <li>เดือนปัจจุบันเว้นว่างไว้ ให้ได้ลองออกบิลทั้งหอด้วยมือตัวเอง</li>
            </ul>
            ${primaryCta()}
            <p class="note">เดโมใช้ฐานข้อมูลคนละก้อนกับหอจริง แก้หรือลบข้อมูลในนั้นได้ไม่มีผลกับข้อมูลจริง</p>
          </div>

          <div>
            <div class="closure">
              <h3>สิ่งที่ปิดไว้ในโหมดตัวอย่าง</h3>
              <ul>
                <li>ไม่ส่งข้อความ LINE จริงถึงใคร</li>
                <li>ไม่เรียกบริการตรวจสลิปที่คิดค่าใช้จ่ายต่อครั้ง</li>
                <li>ไม่ผูก LINE ด้วยรหัสของเจ้าของหอ</li>
              </ul>
              <p>สามอย่างนี้เป็นจุดเดียวที่ระบบติดต่อออกไปข้างนอก การปิดจึงเกิดจากโหมดตัวอย่างโดยตรง ไม่ได้พึ่งการเว้นคีย์ว่าง ปุ่มที่เกี่ยวข้องจะตอบกลับว่าเปิดใช้ในโหมดสาธิตไม่ได้</p>
            </div>

            <div class="closure">
              <h3>เดโมนี้ใช้ร่วมกัน</h3>
              <p>ทุกคนที่เข้าไปเห็นข้อมูลชุดเดียวกันและแก้ข้อมูลชุดเดียวกัน ข้อมูลอาจถูกแก้โดยผู้ชมคนอื่น หรือถูกรีเซ็ตกลับเป็นชุดตั้งต้นได้ตลอดเวลา เดโมจึงไม่ใช่พื้นที่ส่วนตัว และไม่ควรใส่ข้อมูลจริงลงไป</p>
            </div>

            <p class="note">ข้อมูลทั้งหมดในเดโมเป็นชุดตัวอย่างที่สร้างขึ้นสำหรับหน้านี้ ไม่ใช่ข้อมูลผู้เช่าจริงของหอใด</p>
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
        ${primaryCta()}
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
      ${contextSection()}
      ${demoSection()}
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
