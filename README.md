# Wang Chan Dorm

ระบบจัดการหอพักสำหรับเจ้าของคนเดียว — Cloudflare Workers + Hono (API) และ React + Vite + Tailwind (SPA) ใน Worker เดียว

## Requirements

- Node.js 24 หรือใหม่กว่า
- npm (ใช้ npm เท่านั้น)
- บัญชี Cloudflare สำหรับ deploy

## Install

```bash
npm install
npx wrangler types
```

`npm install` ติดตั้ง devDependencies ด้วย ถ้า shell ของคุณตั้ง `NODE_ENV=production` ไว้ ให้ใช้ `NODE_ENV=development npm install` ไม่งั้น npm จะข้าม devDependencies ทั้งหมด

`npx wrangler types` จะสร้าง `worker-configuration.d.ts` จาก `wrangler.jsonc` ไฟล์นี้ถูก commit ไว้ เพราะโปรเจกต์นี้ห้ามเขียน type `Env` เอง ให้รันคำสั่งนี้ใหม่ทุกครั้งที่เพิ่มหรือเปลี่ยน binding

## Local development

```bash
npm run dev
```

`predev` จะรัน `npm run build` ก่อน เพื่อให้มีโฟลเดอร์ `dist/client` ให้ wrangler เสิร์ฟ (wrangler ต้องมี assets directory อยู่จริงจึงจะ start ได้) จากนั้น `concurrently` จะรันสองอย่างพร้อมกัน

- `wrangler dev` ที่ http://127.0.0.1:8787 — API, SPA ที่ build แล้ว และ binding จริง (D1/R2 แบบ local)
- `vite dev` — dev server ของ client พร้อม proxy `/api` และ `/health` ไปที่ 127.0.0.1:8787

เปิดใช้งาน UI ผ่าน vite dev server เพื่อให้ได้ hot reload ส่วน API วิ่งไปที่ wrangler

## Database

สร้าง D1 และ R2 จริงก่อน deploy แล้วแทนที่ค่า placeholder ใน `wrangler.jsonc`

```bash
npx wrangler d1 create wangchan-dorm
npx wrangler r2 bucket create wangchan-dorm-slips
```

นำ `database_id` ที่ได้ไปวางแทน `PLACEHOLDER_CREATE_ME` ใน `wrangler.jsonc` แล้วรัน `npx wrangler types` อีกครั้ง (ค่านี้ต้องเป็น UUID จริง ห้ามใช้ placeholder ตอน deploy)

Migrations อยู่ใน `migrations/`

```bash
npx wrangler d1 migrations apply wangchan-dorm --local
npx wrangler d1 migrations apply wangchan-dorm --remote
```

## Tests

```bash
npm test
```

ใช้ `vitest` + `@cloudflare/vitest-pool-workers` เทสต์รันใน Workers runtime จริงพร้อม binding จริง

- `test/health.test.ts` ยิง `GET /health` ผ่าน `SELF.fetch` แล้วตรวจว่า D1 และ R2 ตอบ ok
- `test/seam.test.ts` เทสต์ seam ของโปรเจกต์ ยิง `POST /api/seam-probe` แล้วตรวจ D1 write/read, R2 write/read และ outbound fetch ที่ถูกดักไว้
- `test/setup.ts` apply D1 migrations ก่อนเทสต์ทุกไฟล์ โดยรับ migration list ผ่าน binding `TEST_MIGRATIONS` ที่กำหนดใน `vitest.config.ts`

`POST /api/seam-probe` ถูกปิดใน production ด้วย var `SEAM_PROBE` (ค่า `0` ใน `wrangler.jsonc`) และเปิดเฉพาะในเทสต์ด้วย miniflare binding override ใน `vitest.config.ts`

## Typecheck / lint / full check

```bash
npm run typecheck   # tsc --noEmit ทั้ง tsconfig.worker.json และ tsconfig.client.json
npm run lint        # eslint แบบ flat config + type-aware rules
npm run check       # typecheck + lint + test สำหรับ CI
```

## Secrets

Secrets ไม่ถูกเก็บใน repo หรือใน `wrangler.jsonc` เด็ดขาด

Production:

```bash
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put EASYSLIP_API_KEY
npx wrangler secret put OWNER_LINK_CODE
```

Local: คัดลอก `.dev.vars.example` เป็น `.dev.vars` แล้วใส่ค่าจริง ไฟล์ `.dev.vars` ถูก gitignore ไว้แล้ว

## Deploy

```bash
npm run deploy
```

คำสั่งนี้ build client ไปที่ `dist/client` แล้ว `wrangler deploy` ทั้ง Worker และ static assets พร้อมกัน

## Access

หอพักนี้มีเจ้าของคนเดียว จึงควรปิดทั้งเว็บด้วย Cloudflare Access (Zero Trust) ไม่ใช่เปิดให้ใครก็เข้าได้

1. ตั้งชื่อโฮสต์ให้ Worker (เช่น `dorm.example.com`) ด้วย custom domain
2. สร้าง Access application ครอบโฮสต์นั้น
3. เพิ่ม policy แบบ Allow เฉพาะอีเมลของเจ้าของ
4. ถ้าจะให้ LINE webhook เรียกเข้ามา ให้แยก path `/webhook/*` ออกจาก Access (ใช้ Service Token หรือ policy แยก) เพราะ LINE ไม่ผ่าน login ของ Cloudflare

การจัดการ asset และ API:

- `assets.run_worker_first` เป็น array ของ glob `["/api/*", "/health", "/webhook/*", "/qr/*", "/slips/*"]` ทำให้ path เหล่านี้วิ่งเข้า Worker เสมอ ส่วน path อื่นถูกเสิร์ฟเป็น static asset และ fallback เป็น SPA (`not_found_handling: "single-page-application"`)
- ถ้าเพิ่ม path API ใหม่ ต้องเพิ่ม glob ใน `assets.run_worker_first` ด้วย ไม่งั้นจะได้ index.html แทน JSON

## โครงสร้างไฟล์

```
src/worker/       Hono app (index.ts) และ routes (health, seam-probe)
src/client/       React SPA (main.tsx, App.tsx, pages.tsx, styles.css)
migrations/       D1 migrations
test/             vitest + @cloudflare/vitest-pool-workers
```

## Notes on versions

- `vitest` ถูก pin ที่ v4 เพราะ `@cloudflare/vitest-pool-workers` กำหนด peer ไว้ที่ `vitest ^4.1.0`
- v0.22.0 ของ pool ใช้ miniflare/workerd ที่เก่ากว่า `compatibility_date` ของโปรเจกต์ จึงกำหนด `overrides.miniflare` ใน `package.json` ให้ตรงกับ miniflare ที่ wrangler 4.131.1 ใช้ เพื่อให้เทสต์รันด้วย workerd ตัวเดียวกับตอน dev และ deploy
