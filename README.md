# Wang Chan Dorm

ระบบจัดการหอพักสำหรับเจ้าของคนเดียว — ออกบิลรายเดือน เก็บค่าเช่า และปิดบิลอัตโนมัติเมื่อผู้เช่าส่งสลิปการโอนผ่าน LINE

ผู้เช่าไม่ต้องติดตั้งแอปหรือจำรหัสอะไร ส่งรูปสลิปในแชทของหอ ระบบอ่านสลิป เทียบยอดกับบิล แล้วปิดบิลให้เอง
สลิปที่อ่านไม่ได้หรือยอดไม่ตรงเข้าคิว "รอตรวจ" ให้เจ้าของตัดสิน เจ้าของเห็นทุกอย่างที่จำเป็นในหน้าเดียว

- Production: https://wangchan-dorm.nodhk2545.workers.dev
- Live demo (ข้อมูลตัวอย่าง สาธารณะ): https://wangchan-demo.nodhk2545.workers.dev

## Tech stack

| ส่วน | เทคโนโลยี |
|------|-----------|
| Runtime | Cloudflare Workers (Worker เดียวเสิร์ฟทั้ง API และ SPA) |
| API | Hono 4 + TypeScript |
| ฐานข้อมูล | Cloudflare D1 (SQLite) — 11 migrations |
| ไฟล์ | Cloudflare R2 (เก็บรูปสลิป) |
| Frontend | React 19 + Vite 8 + Tailwind CSS 4 |
| LINE | Messaging API + LIFF (ลงทะเบียนผู้เช่า) + Rich menu |
| ตรวจสลิป | SlipOK API |
| ใบแจ้งหนี้ | `pdf-lib` + ฟอนต์ไทย IBM Plex Sans Thai (ฝังใน Worker) |
| เทสต์ | Vitest 4 + `@cloudflare/vitest-pool-workers` (รันใน Workers runtime จริง) |

## ฟีเจอร์หลัก

**บิลรายเดือน** — สร้างบิลทั้งหอในครั้งเดียวจากหน้าจอเดียว รองรับทั้งห้องคิดตามมิเตอร์ (น้ำ/ไฟ หน่วย × อัตรา)
และห้องเหมาจ่าย เซิร์ฟเวอร์คิดยอดเองทั้งหมด ไม่รับยอดที่ client ส่งมา บิลเก็บ snapshot อัตราและเลขมิเตอร์ไว้
แก้ค่าตั้งต้นภายหลังจึงไม่กระทบบิลเก่า

**ส่งบิลทาง LINE** — push ใบแจ้งหนี้เป็น Flex message พร้อมรูป QR พร้อมเพย์และปุ่มเปิด PDF ให้ผู้เช่าแต่ละคน
ส่งทั้งเดือนพร้อมกันได้ และได้สรุปว่าใครยังไม่เชื่อม LINE

**ปิดบิลอัตโนมัติจากสลิป** — ผู้เช่าส่งรูปสลิปในแชท ระบบดาวน์โหลดรูป เก็บลง R2 ส่งให้ SlipOK ตรวจ
แล้วปิดบิลให้เองเมื่อยอดตรง สลิปที่อ่านไม่ได้หรือยอดไม่ตรงเข้าคิวรอตรวจพร้อมบอกเหตุผลที่อ่านรู้เรื่อง
สลิปหนึ่งใบปิดได้บิลเดียว บังคับด้วย unique index ที่ฐานข้อมูล

**รอตรวจ** — คิวรวมสลิปที่ต้องตัดสิน พร้อมเหตุผลห้าประเภทแยกให้เห็นชัดว่า "ตรวจไม่ผ่าน" (สลิปมีปัญหา)
ต่างจาก "ตรวจไม่ได้" (ระบบยังไม่ได้คำตอบ) เจ้าของหอต้องทำคนละอย่าง

**แดชบอร์ด** — KPI ของเดือนที่เลือก กราฟรายรับ 6 เดือน บิลค้าง และสถานะทุกห้อง
แยก `behindPeriods` (ยังไม่ได้ออกบิล) กับ `arrears` (ค้างเงินงวดก่อน) ออกจากกัน

**ลงทะเบียนผู้เช่าเองด้วย LIFF** — ผู้เช่าเปิดลิงก์จากใน LINE กรอกชื่อ/เบอร์/เลือกห้อง
ระบบยืนยันตัวตนฝั่งเซิร์ฟเวอร์แล้วสร้างผู้เช่า ผูก LINE และแจ้งเจ้าของ — เจ้าของไม่ต้องกรอกข้อมูลเอง

**Rich menu** — เมนูสี่ปุ่มในแชทหอ (ลงทะเบียน · ส่งสลิป · บิลของฉัน · ติดต่อเจ้าของ)
สร้างจากไฟล์ HTML ในโปรเจกต์นี้อัปโหลดขึ้น LINE ด้วยคำสั่งเดียว

**ใบแจ้งหนี้และ QR** — QR พร้อมเพย์สร้างตามมาตรฐาน EMVCo ทุกครั้งที่เรียก (แก้บิลแล้วรูปเปลี่ยนตาม)
ส่วน PDF สร้างสดจากฐานข้อมูลและฝังฟอนต์ไทย ทำให้คัดลอกข้อความออกมาได้ถูกต้อง

**หลายคนในครอบครัวเดียว** — ข้อมูลผูกกับ "ครอบครัว" ไม่ใช่บัญชีเดียว รับได้สูงสุด 2 คน
มีสิทธิ์สองระดับ (เจ้าของ/สมาชิก) เข้าสู่ระบบด้วยอีเมล-รหัสผ่านหรือ Google

## Requirements

- Node.js 24 หรือใหม่กว่า
- npm (ใช้ npm เท่านั้น)
- บัญชี Cloudflare (สำหรับ deploy)

## Install

```bash
npm install
npx wrangler types
```

`npm install` ติดตั้ง devDependencies ด้วย ถ้า shell ของคุณตั้ง `NODE_ENV=production` ไว้ ให้ใช้
`NODE_ENV=development npm install` ไม่งั้น npm จะข้าม devDependencies ทั้งหมด

`npx wrangler types` สร้าง `worker-configuration.d.ts` จาก `wrangler.jsonc` ไฟล์นี้ถูก commit ไว้
เพราะโปรเจกต์นี้ห้ามเขียน type `Env` เอง ให้รันคำสั่งนี้ใหม่ทุกครั้งที่เพิ่มหรือเปลี่ยน binding
หรือหลังสร้าง `.dev.vars`

## Local development

```bash
npm run dev
```

`predev` จะรัน `npm run build` ก่อน เพื่อให้มีโฟลเดอร์ `dist/client` ให้ wrangler เสิร์ฟ
จากนั้น `concurrently` จะรันสองอย่างพร้อมกัน

- `wrangler dev` ที่ http://127.0.0.1:8787 — API, SPA ที่ build แล้ว และ binding จริง (D1/R2 แบบ local)
- `vite dev` — dev server ของ client พร้อม proxy `/api` และ `/health` ไปที่ 127.0.0.1:8787

เปิดใช้งาน UI ผ่าน vite dev server เพื่อให้ได้ hot reload ส่วน API วิ่งไปที่ wrangler

## Database

D1 และ R2 ของโปรเจกต์นี้สร้างไว้แล้ว ถ้าย้ายบัญชี Cloudflare หรือสร้างใหม่ ให้ทำตามนี้แล้วนำค่าไปแทนใน `wrangler.jsonc`

```bash
npx wrangler d1 create wangchan-dorm
npx wrangler r2 bucket create wangchan-dorm-slips
```

ตารางถูกสร้างเป็นราย ticket ไม่ได้สร้างทั้ง schema ทีเดียว — ดู `migrations/` ตามลำดับ

```bash
npm run db:migrate:local    # apply migrations กับ D1 local
npm run db:seed:local       # ใส่ข้อมูลตัวอย่าง (rooms, tenants, settings)
npm run db:migrate:remote   # apply migrations กับ D1 production
npm run db:seed:remote      # ใส่ข้อมูลตัวอย่างลง D1 production
```

### Seed

ข้อมูลตัวอย่างใช้ `INSERT OR IGNORE` และ id คงที่ จึงรันซ้ำได้โดยไม่ทับหรือสร้างข้อมูลซ้ำ
ห้องตัวอย่าง 18 ห้อง (`A101`–`A118`) ผู้เช่าปัจจุบัน 15 คน และผู้ย้ายออก 1 คน

### นำเข้าข้อมูลจริงจาก Google Sheet

`scripts/import-dorm-sheet.mjs` อ่าน Google Sheet ของเจ้าของหอ สร้าง SQL สำหรับ D1
พร้อมพิมพ์รายงานตรวจสอบบน stdout ไม่มี dependency เพิ่ม และไม่แตะ worker/client/migrations

```bash
node scripts/import-dorm-sheet.mjs                              # เขียน seed/live/import.sql
npx wrangler d1 execute wangchan-dorm --local --file seed/live/import.sql
npx wrangler d1 execute wangchan-dorm --remote --file seed/live/import.sql
```

ไฟล์ผลลัพธ์มีชื่อ เบอร์โทร และ LINE id ของผู้เช่าจริง จึง gitignore ไว้ที่ `seed/live/` ห้าม commit
รหัส Google Sheet เก็บที่ `scripts/.dorm-sheet.env` (gitignored) ไม่ใช่ `.dev.vars`
เพราะคีย์ใน `.dev.vars` จะถูก `wrangler types` ประกาศเป็น binding ของ Worker

## Tests

```bash
npm test
```

ใช้ `vitest` + `@cloudflare/vitest-pool-workers` เทสต์รันใน Workers runtime จริงพร้อม binding จริง
367 เทสต์ใน 16 ไฟล์ ครอบ API ทุกตัว เส้นทาง LINE webhook (ตรวจ signature จริง) การตรวจสลิป
การสร้างใบแจ้งหนี้ และการยืนยันตัวตน โดยดัก outbound `fetch` ทุกครั้งที่ออกไปข้างนอก
จึงไม่มีการเรียก LINE หรือ SlipOK จริงตอนรันเทสต์

```bash
npm run typecheck   # tsc --noEmit ทั้ง tsconfig.worker.json และ tsconfig.client.json
npm run lint        # eslint แบบ flat config + type-aware rules
npm run check       # typecheck + lint + test สำหรับ CI
```

## Secrets

Secrets ไม่ถูกเก็บใน repo หรือใน `wrangler.jsonc` เด็ดขาด

```bash
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put SLIPOK_API_KEY
npx wrangler secret put SLIPOK_BRANCH_ID
```

`LIFF_ID` และ `OWNER_EMAIL` ไม่ใช่ secret — เป็นค่า env ธรรมดาใน `vars` ของ `wrangler.jsonc`
(production) หรือ `.dev.vars` (local) ดูขั้นตอนสร้าง LIFF app ใน `docs/features.md`

Local: คัดลอก `.dev.vars.example` เป็น `.dev.vars` แล้วใส่ค่าจริง ไฟล์ `.dev.vars` ถูก gitignore ไว้แล้ว
หลังใส่ค่าเสร็จให้รัน `npx wrangler types` เพื่อให้ `Env` มีชื่อ secret ครบ

## Deploy

```bash
npm run deploy
```

คำสั่งนี้ build client ไปที่ `dist/client` แล้ว `wrangler deploy` ทั้ง Worker และ static assets พร้อมกัน
สคริปต์ทั้งหมด pin `--env=''` ไว้ เพื่อไม่ให้ `env.demo` ถูกใช้โดยไม่ตั้งใจ

`wrangler.jsonc` มี `env.demo` เป็น Worker แยกต่างหาก (`wangchan-demo`) พร้อม D1 และ R2 ของตัวเอง
ใช้ `DEMO_MODE=1` และไม่มี secret จริง จึงส่งข้อความออกไปไม่ได้ — เป็นฉากหลังของหน้า `/welcome`

## เอกสารเพิ่มเติม

- `docs/features.md` — พฤติกรรมระดับ implementation ของ API ทุกตัว เงื่อนไขการปิดบิล นโยบายการคิดเงิน LINE bot และการยืนยันตัวตน
- `docs/adr/` — ADR ของการตัดสินใจที่สำคัญ
- `docs/specs/` — สเปกของแต่ละงาน
- `CONTEXT.md` — คำศัพท์ของโดเมนนี้
- `DESIGN.md` — แนวทาง UI
