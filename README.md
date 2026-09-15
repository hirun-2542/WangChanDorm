# Wang Chan Dorm

ระบบจัดการหอพักสำหรับเจ้าของคนเดียว — Cloudflare Workers + Hono (API) และ React + Vite + Tailwind (SPA) ใน Worker เดียว

- Production: https://wangchan-dorm.nodhk2545.workers.dev
- D1 database: `wangchan-dorm` (APAC, id `985296cf-2b88-4f8f-b8f8-57e1fb508456`)
- R2 bucket: `wangchan-dorm-slips`

## Requirements

- Node.js 24 หรือใหม่กว่า
- npm (ใช้ npm เท่านั้น)
- บัญชี Cloudflare (สำหรับ deploy)

## Install

```bash
npm install
npx wrangler types
```

`npm install` ติดตั้ง devDependencies ด้วย ถ้า shell ของคุณตั้ง `NODE_ENV=production` ไว้ ให้ใช้ `NODE_ENV=development npm install` ไม่งั้น npm จะข้าม devDependencies ทั้งหมด

`npx wrangler types` จะสร้าง `worker-configuration.d.ts` จาก `wrangler.jsonc` ไฟล์นี้ถูก commit ไว้ เพราะโปรเจกต์นี้ห้ามเขียน type `Env` เอง ให้รันคำสั่งนี้ใหม่ทุกครั้งที่เพิ่มหรือเปลี่ยน binding หรือหลังสร้าง `.dev.vars` (secrets ใน `.dev.vars` จะถูกเพิ่มเข้า `Env` ให้อัตโนมัติ)

## Local development

```bash
npm run dev
```

`predev` จะรัน `npm run build` ก่อน เพื่อให้มีโฟลเดอร์ `dist/client` ให้ wrangler เสิร์ฟ (wrangler ต้องมี assets directory อยู่จริงจึงจะ start ได้) จากนั้น `concurrently` จะรันสองอย่างพร้อมกัน

- `wrangler dev` ที่ http://127.0.0.1:8787 — API, SPA ที่ build แล้ว และ binding จริง (D1/R2 แบบ local)
- `vite dev` — dev server ของ client พร้อม proxy `/api` และ `/health` ไปที่ 127.0.0.1:8787

เปิดใช้งาน UI ผ่าน vite dev server เพื่อให้ได้ hot reload ส่วน API วิ่งไปที่ wrangler

## Database

D1 และ R2 ของโปรเจกต์นี้สร้างไว้แล้ว (ดูชื่อและ id ด้านบน) ถ้าย้ายบัญชี Cloudflare หรือสร้างใหม่ ให้ทำตามนี้แล้วนำค่าไปแทนใน `wrangler.jsonc`

```bash
npx wrangler d1 create wangchan-dorm
npx wrangler r2 bucket create wangchan-dorm-slips
```

ตารางถูกสร้างเป็นราย ticket ไม่ได้สร้างทั้ง schema ทีเดียว — ดู `migrations/` ตามลำดับ

```bash
npx wrangler d1 migrations apply wangchan-dorm --local
npx wrangler d1 migrations apply wangchan-dorm --remote
```

### Seed

ข้อมูลตัวอย่างใช้ `INSERT OR IGNORE` และ id คงที่ จึงรันซ้ำได้โดยไม่ทับหรือสร้างข้อมูลซ้ำ

- `seed/rooms.sql` — ห้องตัวอย่าง 18 ห้อง (`A101`–`A118`) id `room-a101` …
- `seed/tenants.sql` — ผู้เช่าปัจจุบัน 15 คน (ห้องที่มีผู้เช่า) และผู้ย้ายออก 1 คน (`ปกรณ์ วังทอง` ห้อง `room-a104`) id `tenant-a101` … วันที่เก็บเป็น ISO `YYYY-MM-DD`
- `seed/settings.sql` — ค่าตั้งต้นของหอ (ชื่อหอ/เจ้าของ, อัตราน้ำ/ไฟ, พร้อมเพย์) id เป็น key ของตาราง `settings` ไม่ seed `owner_line_user_id` เพราะรอ ticket 05 และไม่ seed รหัสเชื่อมเจ้าของ เพราะระบบสร้างรหัสใหม่ให้อัตโนมัติเมื่ออ่านค่าครั้งแรก

```bash
npm run db:migrate:local    # apply migrations กับ D1 local
npm run db:seed:local       # ใส่ข้อมูลห้อง ผู้เช่า และค่าตั้งต้นหอลง D1 local (ทั้งสามไฟล์)
npm run db:migrate:remote   # apply migrations กับ D1 production
npm run db:seed:remote      # ใส่ข้อมูลห้อง ผู้เช่า และค่าตั้งต้นหอลง D1 production (ทั้งสามไฟล์)
```

## Tests

```bash
npm test
```

ใช้ `vitest` + `@cloudflare/vitest-pool-workers` เทสต์รันใน Workers runtime จริงพร้อม binding จริง

- `test/health.test.ts` ยิง `GET /health` ผ่าน `SELF.fetch` แล้วตรวจว่า D1 และ R2 ตอบ ok
- `test/seam.test.ts` เทสต์ seam ของโปรเจกต์ ยิง `POST /api/seam-probe` แล้วตรวจ D1 write/read, R2 write/read + การลบ object หลังใช้ และ outbound fetch (URL, method และ body) ที่ถูกดักไว้
- `test/rooms.test.ts` และ `test/tenants.test.ts` ยิง REST API จริงเข้า `/api/rooms` และ `/api/tenants` แล้วตรวจสถานะที่อ่านกลับได้
- `test/settings.test.ts` ยิง `/api/settings` ตรวจค่าเริ่มต้น, subset PUT, การปฏิเสธค่าไม่ถูกต้อง, unknown key และการออกรหัสเจ้าของใหม่
- `test/bills.test.ts` ยิง `/api/bills` ตรวจ meter sheet (เฉพาะห้องที่มีผู้เช่า + อัตราที่ใช้จริง), การสร้างบิลห้องมิเตอร์/ห้องเหมา/บิลที่มีค่าใช้จ่ายเพิ่ม, มิเตอร์ย้อนหลัง, สร้างซ้ำเดือนเดิม, ห้องว่าง และการ snapshot เลขมิเตอร์ลงบิลรอบถัดไป
- `test/line.test.ts` เซ็น signature จริง (HMAC-SHA256 ด้วย `LINE_CHANNEL_SECRET` ของเทสต์) แล้วยิงเข้า `/webhook/line` ตรวจการปฏิเสธ signature ที่ผิด, event `follow`, การผูกผู้เช่าด้วยเลขห้อง, รหัสเจ้าของ, คิวรอเชื่อม และ endpoint จับคู่ด้วยมือ — outbound `fetch` ไป LINE ถูกดักด้วย spy
- `test/setup.ts` apply D1 migrations ก่อนเทสต์ทุกไฟล์ โดยรับ migration list ผ่าน binding `TEST_MIGRATIONS` ที่กำหนดใน `vitest.config.ts`

`POST /api/seam-probe` ถูกปิดใน production ด้วย var `SEAM_PROBE` (ค่า `0` ใน `wrangler.jsonc`) และเปิดเฉพาะในเทสต์ด้วย miniflare binding override ใน `vitest.config.ts`

## บิลรายเดือน

- `period` เป็น ค.ศ. รูปแบบ `YYYY-MM` (เช่น `2026-09` = กันยายน 2569) เก็บในตาราง `bills` ฝั่ง client เป็นหน้าที่แปลงเป็น พ.ศ.
- `GET /api/bills?period=YYYY-MM` — บิลของเดือนนั้น เรียงตามเลขห้อง พร้อมชื่อห้อง/ผู้เช่าและค่าใช้จ่ายเพิ่มเติม (camelCase, แบน)
- `GET /api/bills/meter-sheet?period=YYYY-MM` — เฉพาะห้องที่มีผู้เช่าปัจจุบัน เรียงตามเลขห้อง พร้อม `waterPrevious`/`electricPrevious` จากบิลล่าสุดของห้อง (หรือเลขเริ่มต้นตอนสร้างห้อง), อัตราที่ใช้จริง (override ของห้อง ?? ค่า default จาก settings) และ `existingBillId` เมื่อห้องนั้นมีบิลของเดือนนี้แล้ว
- `POST /api/bills/generate {period, entries:[{roomId, waterCurrent, electricCurrent, flatElectricAmount?, charges?}]}` — เซิร์ฟเวอร์คิดยอดเงินเองทั้งหมด (หน่วย × อัตรา ปัดด้วย `Math.round`, ห้องเหมาใช้ยอดที่ส่งมา, total = ค่าห้อง + น้ำ + ไฟ + ผลรวมค่าใช้จ่ายเพิ่ม) แล้วเขียนบิลและค่าใช้จ่ายเพิ่มใน `DB.batch` เดียว; ตรวจทั้งหมดก่อนเขียน (ถ้าไม่ผ่านจะไม่เขียนอะไรเลย) — มิเตอร์ย้อนหลัง `400`, ห้องว่าง/ไม่พบห้อง `400`, สร้างซ้ำเดือนเดิม `409`
- บิลเก็บ snapshot อัตรา เลขมิเตอร์ โหมดค่าไฟ และค่าใช้จ่ายเพิ่ม ณ วันสร้าง แก้ settings หรือโหมดของห้องภายหลังไม่กระทบบิลเก่า

## Typecheck / lint / full check

```bash
npm run typecheck   # tsc --noEmit ทั้ง tsconfig.worker.json และ tsconfig.client.json
npm run lint        # eslint แบบ flat config + type-aware rules
npm run check       # typecheck + lint + test สำหรับ CI
```

## Secrets

Secrets ไม่ถูกเก็บใน repo หรือใน `wrangler.jsonc` เด็ดขาด ตอนนี้ยังไม่ได้ตั้งค่าจริงใน production รอค่าจาก LINE Official Account และ EasySlip (ใช้ครั้งแรกใน ticket 05 และ 09)

Production:

```bash
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put EASYSLIP_API_KEY
```

รหัสเชื่อมเจ้าของไม่ใช่ secret — เก็บอยู่ในตาราง `settings` ของ D1 และแสดงในหน้าตั้งค่าของแอป (กดออกรหัสใหม่ได้จากที่นั่น) จึงไม่ต้องตั้งผ่าน `wrangler secret`

Local: คัดลอก `.dev.vars.example` เป็น `.dev.vars` แล้วใส่ค่าจริง ไฟล์ `.dev.vars` ถูก gitignore ไว้แล้ว หลังใส่ค่าเสร็จให้รัน `npx wrangler types` เพื่อให้ `Env` มีชื่อ secret ครบ

## LINE bot

- `POST /webhook/line` เป็น path สาธารณะ (ไม่มี Access) ตรวจ `X-Line-Signature` แบบ HMAC-SHA256 จาก raw body ก่อนทุกอย่าง ถ้า signature ไม่ถูกต้องตอบ `403` และไม่แตะฐานข้อมูล
- event `follow` → บอททักทายและขอเลขห้อง; ข้อความ text ที่ตรงกับเลขห้องของผู้เช่าปัจจุบันที่ยังไม่เชื่อม → ผูก `tenants.line_user_id`; ข้อความที่ตรงกับรหัส 6 หลักใน `settings.owner_link_code` → บันทึก `settings.owner_line_user_id`; ข้อความอื่น → เก็บในตาราง `line_pending` ให้เจ้าของจับคู่เอง
- `/api/line/pending` (GET) และ `/api/line/pending/:lineUserId/link` (POST) อยู่หลัง Access ใช้โดยหน้าผู้เช่าในส่วนจัดการการเชื่อม LINE
- ตอบ `200` เสมอเมื่อ signature ถูกต้อง เพื่อไม่ให้ LINE ยิงซ้ำเพราะ timeout; การเรียก LINE API ขาออกล้มเหลวได้โดยไม่ทำให้ webhook พัง

## Deploy

```bash
npm run deploy
```

คำสั่งนี้ build client ไปที่ `dist/client` แล้ว `wrangler deploy` ทั้ง Worker และ static assets พร้อมกัน

## Access (ยังไม่ได้ตั้งค่า)

หอพักนี้มีเจ้าของคนเดียว จึงควรปิดทั้งเว็บด้วย Cloudflare Access (Zero Trust) ไม่ใช่เปิดให้ใครก็เข้าได้

1. ผูก custom domain ให้ Worker (เช่น `dorm.example.com`) — Access ครอบโดเมน `*.workers.dev` ไม่ได้ ต้องมี custom domain ก่อน
2. สร้าง Access application ครอบโฮสต์นั้น
3. เพิ่ม policy แบบ Allow เฉพาะอีเมลของเจ้าของ
4. แยก path ที่ต้องเปิดสาธารณะออกจาก Access: `/webhook/*` (LINE เรียกเข้ามา), `/qr/*` และ `/slips/*` (ให้ LINE และ EasySlip ดึงรูป) — เช่นใช้ Bypass policy ตาม path

การจัดการ asset และ API:

- `assets.run_worker_first` เป็น array ของ glob `["/api/*", "/health", "/webhook/*", "/qr/*", "/slips/*"]` ทำให้ path เหล่านี้วิ่งเข้า Worker เสมอ ส่วน path อื่นถูกเสิร์ฟเป็น static asset และ fallback เป็น SPA (`not_found_handling: "single-page-application"`)
- ถ้าเพิ่ม path API ใหม่ ต้องเพิ่ม glob ใน `assets.run_worker_first` ด้วย ไม่งั้นจะได้ index.html แทน JSON

## โครงสร้างไฟล์

```
src/worker/       Hono app (index.ts) และ routes (health, rooms, tenants, bills, settings, line, seam-probe)
src/worker/line/  signature (HMAC-SHA256), LINE Messaging API client และข้อความภาษาไทย
src/client/       React SPA (main.tsx, App.tsx, api.ts, styles.css)
src/client/pages/ หน้าจอแต่ละหน้า (rooms, tenants, settings, bills, dashboard, ...)
migrations/       D1 migrations
seed/             ข้อมูลตัวอย่าง (rooms.sql, tenants.sql, settings.sql)
test/             vitest + @cloudflare/vitest-pool-workers
design/           prototype UX/UI (ไฟล์อ้างอิง ไม่ได้ build)
docs/             spec และ ADR
```

## หมายเหตุเรื่อง UI

โครง app ตอนนี้ mirror จาก `design/index.html` (เวอร์ชันล่าสุด) — search bar, ปุ่มแจ้งเตือน และ Ctrl K ใน topbar เป็นโครง UI เปล่ายังไม่ทำงานจริง เพราะยังไม่มี ticket ที่รองรับ

## Notes on versions

- `vitest` ถูก pin ที่ v4 เพราะ `@cloudflare/vitest-pool-workers` กำหนด peer ไว้ที่ `vitest ^4.1.0`
- v0.22.0 ของ pool ใช้ miniflare/workerd ที่เก่ากว่า `compatibility_date` ของโปรเจกต์ จึงกำหนด `overrides.miniflare` ใน `package.json` ให้ตรงกับ miniflare ที่ wrangler 4.131.1 ใช้ เพื่อให้เทสต์รันด้วย workerd ตัวเดียวกับตอน dev และ deploy
