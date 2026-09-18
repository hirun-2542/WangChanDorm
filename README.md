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
- `test/bills.test.ts` ยิง `/api/bills` ตรวจ meter sheet (เฉพาะห้องที่มีผู้เช่า + อัตราที่ใช้จริง), การสร้างบิลห้องมิเตอร์/ห้องเหมา/บิลที่มีค่าใช้จ่ายเพิ่ม, มิเตอร์ย้อนหลัง, สร้างซ้ำเดือนเดิม, ห้องว่าง, การ snapshot เลขมิเตอร์ลงบิลรอบถัดไป และการจัดการบิลหลังสร้าง (แก้/ลบ unpaid รวมค่าใช้จ่ายเพิ่มและยอดเหมา, ปฏิเสธ paid ด้วย `409`, ปิดบิลด้วย `mark-paid`, unknown id `404`)
- `test/bills-render.test.ts` ตรวจ payload พร้อมเพย์ (CRC16 known vector + payload ที่ตรงกับ implementation อ้างอิง), ตัวสร้างแถวใบแจ้งหนี้ (ห้องมิเตอร์/ห้องเหมา/ค่าใช้จ่ายเพิ่ม) และ route สาธารณะ `/qr/:billId.png` กับ `/invoices/:billId.pdf` (สถานะ, content-type, PNG/PDF signature, ขนาดไฟล์, ยอดที่เปลี่ยนตามบิลหลัง `PATCH`, การฝังรูป QR ลงใน PDF โดยเทียบกับตอนยังไม่ตั้งพร้อมเพย์, unknown id `404`)
- `test/bills-send.test.ts` ยิง endpoint ส่งบิลจริงโดยดัก outbound `fetch` ไป LINE ด้วย spy ตรวจว่า push ไป userId ของผู้เช่าเป็น flex ที่มียอดครบ (ห้องเหมา + ค่าใช้จ่ายเพิ่ม), QR/PDF URL, altText, `sent_at` ถูกตั้ง, ผู้เช่าที่ยังไม่เชื่อม `409` / ถูกข้าม, unknown id `404`, `send-all` นับ sent/failed/skipped และส่งสรุปถึงเจ้าของ (ไม่ส่งเมื่อเจ้าของยังไม่เชื่อม), push ล้มเหลวไม่บันทึก `sent_at` และเดือนที่ไม่มีบิล `400`
- `test/line.test.ts` เซ็น signature จริง (HMAC-SHA256 ด้วย `LINE_CHANNEL_SECRET` ของเทสต์) แล้วยิงเข้า `/webhook/line` ตรวจการปฏิเสธ signature ที่ผิด, event `follow`, การผูกผู้เช่าด้วยเลขห้อง, รหัสเจ้าของ, คิวรอเชื่อม และ endpoint จับคู่ด้วยมือ, คีย์เวิร์ดเมนูหลักทั้งสี่ (`ส่งสลิป` `บิลของฉัน` `ติดต่อเจ้าของ` `ลงทะเบียน`) ทั้งผู้ใช้ที่เชื่อมแล้วและยังไม่เชื่อม (สถานะบิลจริง: ค้าง/จ่ายแล้ว/ยังไม่มีบิล, เบอร์เจ้าของว่าง vs ตั้งค่า) และการ round-trip/ปฏิเสธค่า `owner_phone` ผ่าน `/api/settings` — outbound `fetch` ไป LINE ถูกดักด้วย spy
- `test/slips.test.ts` เซ็น webhook จริงแล้วส่ง event รูปสลิปเข้า `/webhook/line` โดยดัก outbound `fetch` (ดาวน์โหลดรูปจาก data host, SlipOK, push LINE) ตรวจว่าดาวน์โหลดรูปและเก็บลง R2 แล้วเรียก `/slips/{key}.png` อ่าน bytes กลับมาได้, SlipOK ถูกเรียกด้วย URL สาธารณะของรูปพร้อมยอดบิลที่คาดไว้และ header `x-authorization`, ยอดตรงปิดบิล (`paid`, `paid_method: transfer`, `paid_at` เป็น ISO มาตรฐาน, slip `matched` พร้อม `bill_id`/`bill_total`, push ยืนยัน) ทั้งบิลที่มีค่าใช้จ่ายเพิ่มและห้องเหมาจ่าย และ fallback เป็นเวลาปัจจุบันเมื่อวันที่บนสลิปใช้ไม่ได้, ยอดต่าง 50 สตางค์ไม่ปิดบิล (slip `pending_review` พร้อม `bill_id`/`bill_total`/reason `mismatch`), ตรวจไม่ผ่าน (รหัส 1006/1007/1009), payload ที่ไม่ประกาศ `success`, payload ที่ไม่มี `amount` หรือไม่มีคีย์/รหัสสาขา = ไม่ปิดบิล (reason `not_verified`), ห้องไม่มีบิลค้าง (reason `no_unpaid_bill`), เจ้าของปิดบิลเองระหว่างตรวจสลิปแล้วสลิปไม่ re-pay, ส่ง `transRef` เดิมซ้ำ (รวม webhook สองอันพร้อมกัน) = ใบที่สอง `rejected` reason `duplicate_slip` และไม่ปิดบิลที่สอง, รหัส `1012` จากผู้ให้บริการ = สลิปถูกปฏิเสธแบบ `duplicate_slip` โดยไม่แตะบิล, รหัส `1013` = สลิปจริงแต่ยอดต่างแล้วให้การเทียบของเราตัดสิน, รูปที่ `content-type` ไม่ใช่ png/jpeg/webp หรือ body เกินขนาดถูกปฏิเสธโดยไม่เก็บอะไร, ผู้ส่งที่ยังไม่เชื่อม LINE ไม่เก็บรูป/ไม่สร้างแถวสลิป และ `/slips/{key}.png` ของคีย์ที่ไม่รู้จัก `404`; **ticket 10 เพิ่ม**: สลิปเข้าคิวแล้ว push แจ้งเจ้าของถูกเนื้อหา (ห้อง ชื่อผู้เช่า ยอดในสลิป vs ยอดบิลที่เทียบ และกรณีไม่มีบิลค้างบอกว่าไม่มีบิลให้เทียบ), เจ้าของยังไม่เชื่อม LINE = ไม่มี push และไม่มีอะไรพัง, `GET /api/slips` คืนเฉพาะ `pending_review` โดยปริยายพร้อมฟิลด์ที่หน้า รอตรวจ ใช้ครบ (path รูป, reason, ยอดในสลิป, ห้อง/เดือน/ยอดของบิลที่เทียบ) และ `?billId=` / `?status=` กรองได้ตามสัญญา (`status` ผิดคำศัพท์ `400`), `settle` ปิดบิล (`transfer`, วันที่จากสลิป) + สลิป `matched` + push ยืนยันถึงผู้เช่า และสลิปหายจากคิว, `settle` ที่บิลจ่ายแล้ว/`trans_ref` ซ้ำ/สลิปที่ตัดสินแล้ว = `409` โดยไม่มีอะไรเปลี่ยน, `billId` ใน body ใช้ปิดบิลที่ยังไม่ผูกกับสลิปได้ (ไม่มีทั้งคู่ `400`, บิลไม่รู้จัก `404`), `reject` ทำสลิปเป็น `rejected` (บันทึก `decision`/`decidedAt`) บิลไม่เปลี่ยน ไม่ push, และ id ที่ไม่รู้จัก `404` ทั้งสองคำสั่ง
- `test/stats.test.ts` ยิง `/api/stats/dashboard` ตรวจ KPI ตรงกับบิลที่สร้าง (จ่าย/ค้าง/ห้องว่าง, `sentCount`/`paidCount`), กราฟรายรับ 6 เดือนจบที่เดือนที่เลือก (นับเฉพาะบิลที่จ่ายแล้ว เดือนที่ไม่มีบิลเป็น 0), ลิสต์บิลค้างเก่าสุดก่อนพร้อม `hasPendingSlip`, สลิป `pending_review` ขึ้นธงทั้งใน `unpaidBills` และ `rooms`, สถานะห้องตามบิลของเดือนนั้น, `period` ผิดหรือไม่ส่ง = `400`, และเดือนที่ไม่มีบิล = เลขศูนย์ + 6 แท่งศูนย์ (ทุกเทสต์รีเซ็ตตารางที่เขียนใน `beforeEach` แล้วสร้าง fixture ผ่าน API)
- `test/register.test.ts` ยิง `/api/register` และ `/api/register/rooms` จริงโดยดัก outbound `fetch` (LINE profile + push) ตรวจว่าการลงทะเบียนที่ถูกต้องสร้างผู้เช่า ผูก LINE พลิกห้องเป็นมีผู้เช่า ลบแถว `line_pending` และ push ทั้งเจ้าของและผู้เช่า (assert เนื้อหาข้อความที่ส่งออกไป), token ผิด/หมดอายุ `401` โดยไม่สร้างอะไรและไม่ push, LINE ที่ลงทะเบียนไว้แล้ว `409` (บอกเลขห้อง), ห้องมีผู้เช่าแล้ว `409`, ไม่พบห้อง `404`, ค่าที่ผิด (ชื่อ/เบอร์/ห้อง/โทเคน) `400` พร้อม `field`, รายการห้องว่างเท่านั้นเรียงตามเลขห้องและไม่ leak ชื่อผู้เช่า และหน้า `GET /register` ฝัง LIFF id เมื่อตั้งค่าแล้วแต่แสดงหน้าจอ "เปิดจาก LINE" เมื่อว่าง
- `test/setup.ts` apply D1 migrations ก่อนเทสต์ทุกไฟล์ โดยรับ migration list ผ่าน binding `TEST_MIGRATIONS` ที่กำหนดใน `vitest.config.ts`

`POST /api/seam-probe` ถูกปิดใน production ด้วย var `SEAM_PROBE` (ค่า `0` ใน `wrangler.jsonc`) และเปิดเฉพาะในเทสต์ด้วย miniflare binding override ใน `vitest.config.ts`

## บิลรายเดือน

- `period` เป็น ค.ศ. รูปแบบ `YYYY-MM` (เช่น `2026-09` = กันยายน 2569) เก็บในตาราง `bills` ฝั่ง client เป็นหน้าที่แปลงเป็น พ.ศ.
- `GET /api/bills?period=YYYY-MM` — บิลของเดือนนั้น เรียงตามเลขห้อง พร้อมชื่อห้อง/ผู้เช่า วันที่ออก bิล (`createdAt`) และค่าใช้จ่ายเพิ่มเติม (camelCase, แบน)
- `GET /api/bills/meter-sheet?period=YYYY-MM` — เฉพาะห้องที่มีผู้เช่าปัจจุบัน เรียงตามเลขห้อง พร้อม `waterPrevious`/`electricPrevious` จากบิลล่าสุดของห้อง (หรือเลขเริ่มต้นตอนสร้างห้อง), อัตราที่ใช้จริง (override ของห้อง ?? ค่า default จาก settings) และ `existingBillId` เมื่อห้องนั้นมีบิลของเดือนนี้แล้ว
- `POST /api/bills/generate {period, entries:[{roomId, waterCurrent, electricCurrent, flatElectricAmount?, charges?}]}` — เซิร์ฟเวอร์คิดยอดเงินเองทั้งหมด (หน่วย × อัตรา ปัดด้วย `Math.round`, ห้องเหมาใช้ยอดที่ส่งมา, total = ค่าห้อง + น้ำ + ไฟ + ผลรวมค่าใช้จ่ายเพิ่ม) แล้วเขียนบิลและค่าใช้จ่ายเพิ่มใน `DB.batch` เดียว; ตรวจทั้งหมดก่อนเขียน (ถ้าไม่ผ่านจะไม่เขียนอะไรเลย) — มิเตอร์ย้อนหลัง `400`, ห้องว่าง/ไม่พบห้อง `400`, สร้างซ้ำเดือนเดิม `409`
- `PATCH /api/bills/:id {waterCurrent?, electricCurrent?, flatElectricAmount?, charges?}` — แก้บิลที่ยังไม่จ่าย (`paid` ตอบ `409`); คำนวณหน่วย/ยอดใหม่จากอัตรา snapshot ของบิลเดิม; ส่ง `charges` เป็น array เต็มเพื่อแทนที่รายการเดิม (array ว่าง = ลบทั้งหมด); ห้องเหมาต้องส่ง `flatElectricAmount` (หน่วย/อัตราไฟคงเป็น null) และห้องมิเตอร์ห้ามส่ง; มิเตอร์ต่ำกว่า `waterPrevious`/`electricPrevious` ของบิล `400`; เขียนบิลและค่าใช้จ่ายใน `DB.batch` เดียว
- `DELETE /api/bills/:id` — ลบบิลที่ยังไม่จ่ายพร้อมค่าใช้จ่ายทั้งหมดใน batch เดียว (`paid` ตอบ `409`, ไม่พบ `404`)
- `POST /api/bills/:id/mark-paid {method: transfer|cash, paidAt?}` — ปิดบิลเอง ตั้ง `status = paid` พร้อม `paid_at`/`paid_method`; `paidAt` เป็น ISO `YYYY-MM-DD` หรือ timestamp เต็ม (ไม่ส่งใช้เวลาปัจจุบัน); ช่องทางผิด `400`, ปิดซ้ำ `409`, ไม่พบ `404`
- บิลเก็บ snapshot อัตรา เลขมิเตอร์ โหมดค่าไฟ และค่าใช้จ่ายเพิ่ม ณ วันสร้าง แก้ settings หรือโหมดของห้องภายหลังไม่กระทบบิลเก่า

### ส่งบิลทาง LINE

- `POST /api/bills/:id/send` — push บิลใบนั้นเป็น Flex message ให้ผู้เช่าที่เชื่อม LINE แล้ว; ไม่พบบิล `404`, ผู้เช่ายังไม่เชื่อม `409` (ไม่ส่งอะไร), LINE ปฏิเสธ/เชื่อมไม่ได้ `502` และ**ไม่**บันทึก `sent_at`; สำเร็จ `{ok:true, bill}` พร้อม `sentAt` ใหม่
- `POST /api/bills/send-all {period}` — push ให้ทุกบิลของเดือนนั้นที่ผู้เช่าเชื่อมแล้ว ตั้ง `sent_at` เฉพาะใบที่ส่งสำเร็จ นับใบที่ล้มเหลวไว้โดยไม่หยุดทั้งชุด แล้ว push สรุปให้เจ้าของ (จำนวนบิล, ยอดรวม, ส่งสำเร็จกี่ใบ, ใครยังไม่เชื่อม); เดือนที่ไม่มีบิล `400`; คืน `{ok, period, sent, failed, skipped:[{roomNumber, tenantName}]}` — เจ้าของยังไม่เชื่อม LINE ก็ยังส่งให้ผู้เช่าได้และไม่ push สรุป
- ลิงก์ QR/PDF ในข้อความสร้างจาก **origin ของ request เอง** (`new URL(c.req.url).origin`) ไม่ hardcode โฮสต์ production จึงใช้ได้ทั้ง workers.dev, custom domain และ local dev
- ถ้า origin ของ request ไม่ใช่ https เซิร์ฟเวอร์จะ log คำเตือน เพราะ LINE ปฏิเสธ URL รูปที่ไม่ใช่ https — เกิดเฉพาะตอน dev บน local http เท่านั้น
- Flex message ยึดโครงข้อความของ ticket 08: หัวข้อพื้นทึบ `#2563eb` ตัวอักษรขาว (`ใบแจ้งหนี้ / INVOICE` + `ห้อง … | ประจำเดือน …`), เนื้อมี `ผู้เช่า`, แถว `ออกบิลเมื่อ`, ค่าห้อง/น้ำ/ไฟ (หน่วย × อัตรา หรือ `เหมาจ่าย`) และค่าใช้จ่ายเพิ่มทุกรายการตามชื่อบนบิล, ยอดรวมตัวหนาสีแดง `#dc2626`; ท้ายมีรูป QR `/qr/:billId.png`, ปุ่ม `เปิดใบแจ้งหนี้ PDF` ไปที่ `/invoices/:billId.pdf` และบรรทัดบอกให้ส่งสลิปกลับในแชท — โมดูล builder อยู่ที่ `src/worker/line/bill-message.ts`

## สลิป และการปิดบิลอัตโนมัติ

ผู้เช่าส่งรูปสลิปการโอนกลับมาในแชทบอทเดียวกันได้ ระบบดาวน์โหลดรูป เก็บลง R2 ส่งให้ SlipOK ตรวจ และปิดบิลให้อัตโนมัติเมื่อยอดตรง สลิปที่ตรวจไม่ผ่านหรือยอดไม่ตรงจะถูกเก็บไว้ที่คิว "รอตรวจ" ให้เจ้าของตัดสิน

- **ดาวน์โหลดรูปจาก LINE** — `message` event ที่ `message.type = "image"` จะดึงรูปจาก data host `https://api-data.line.me/v2/bot/message/{messageId}/content` ด้วย bearer token (คนละ host กับ messaging API) รับเฉพาะ `content-type` `image/png`, `image/jpeg`, `image/webp` (อย่างอื่น เช่น `image/svg+xml` ถูกปฏิเสธ เพราะรูปถูกเสิร์ฟจาก origin ของเราเองแบบสาธารณะ) และจำกัดขนาด 5 MiB โดยเช็ค `content-length` เมื่อมี พร้อมอ่านแบบมีขอบเขต (bounded read) กัน body ใหญ่เกินแม้ไม่ประกาศ header — เกิน/ผิดชนิด/ดาวน์โหลดไม่สำเร็จ = ตอบกลับสั้นๆ ว่าลองส่งใหม่ log แบบมีโครงสร้างหนึ่งบรรทัด และไม่เก็บอะไรลง R2/D1
- **คีย์รูปเป็นคีย์สุ่ม 128-bit** (`crypto.getRandomValues` เป็น hex 32 ตัว + `.png`) ไม่ได้มาจากบิล ผู้เช่า หรือ message id และไม่เดาได้ — รูปเดียวกันที่ส่งซ้ำจะได้คนละคีย์
- **`GET /slips/:imageKey.png` เป็น route สาธารณะ** (เหมือน `/qr/*` และ `/invoices/*`) เสิร์ฟ bytes จาก R2 พร้อม content type ที่บันทึกไว้ตอนดาวน์โหลด (มีเฉพาะ `image/png`/`image/jpeg`/`image/webp` แต่ URL ลงท้าย `.png`) และ `cache-control: public, max-age=86400`; ชื่อไฟล์ที่ไม่ใช่ `.png`/`.jpg`/`.jpeg` หรือคีย์ที่ไม่มีใน R2 ตอบ `404` เป็น JSON
- **ต้องอยู่นอก Cloudflare Access**: `/slips/*` ถูกใส่ใน `assets.run_worker_first` แล้ว และต้องเปิดสาธารณะด้วย ไม่งั้น SlipOK ดึงรูปไปตรวจไม่ได้ (ดูหัวข้อ Access ด้านล่าง)
- **ตรวจสลิปด้วย SlipOK** — `POST https://api.slipok.com/api/line/apikey/{branchId}` พร้อม header `x-authorization: <SLIPOK_API_KEY>` และ body `{"url":"{origin}/slips/{imageKey}", "log": false, "amount": <ยอดบิลที่คาดไว้>}` (origin ของ request เอง) ตัวไคลแอนต์เป็น fail-soft: ไม่มีคีย์/รหัสสาขา เรียกไม่สำเร็จ หรือตอบไม่ใช่ JSON → log แบบมีโครงสร้างและคืน `verified: false` ไม่ throw; ถือว่าตรวจผ่านเฉพาะ payload ที่ประกาศ `success: true` และมียอดในสลิปที่อ่านได้; รหัส `1012` (สลิปซ้ำ) ทำให้สลิปถูกปฏิเสธด้วย `duplicate_slip`, รหัส `1013` (ยอดไม่ตรง) ถือว่าสลิปจริงแต่ยอดต่างแล้วให้การเทียบของเราตัดสิน; payload อื่นถือว่าตรวจไม่ผ่าน (ไม่มีทางกลายเป็น "ยอดตรง")
- **ปิดบิลอัตโนมัติ** — เงื่อนไขครบทั้งสามข้อจึงปิดบิล: SlipOK ยืนยันว่าสลิปจริง (`success: true`), ยอดในสลิปเท่ากับ `total` ของบิล unpaid ล่าสุดของห้องผู้ส่ง (เทียบเป็นสตางค์ ไม่เทียบ float — `total` รวมค่าใช้จ่ายเพิ่มและครอบทั้งห้องมิเตอร์และห้องเหมาจ่ายเพราะอ่านจากแถวบิล), และไม่ใช่สลิปซ้ำที่ผู้ให้บริการรายงาน (รหัส `1012`) พร้อมกับที่ `transRef` (ถ้ามี) ไม่เคยถูกใช้ปิดบิลมาก่อน → บิลเป็น `paid` (`paid_method: 'transfer'`, `paid_at` เป็น ISO มาตรฐานที่แปลงจากวันที่บนสลิป ถ้าอ่านไม่ได้ใช้เวลาปัจจุบัน) + สลิปเป็น `matched` + push ยืนยันยอดและเดือนถึงผู้เช่า; การปิดบิลเป็น `UPDATE bills SET status = 'paid', … WHERE id = ? AND status = 'unpaid'` ถ้าไม่มีการเปลี่ยนแปลง (เจ้าของเพิ่งปิดบิลเอง) ถือว่าไม่มีบิลค้างและเก็บสลิปเป็น `pending_review`
- **สลิปหนึ่งใบปิดได้บิลเดียว** — บังคับด้วย partial unique index `idx_slips_matched_trans_ref` บน `slips(trans_ref)` เฉพาะแถว `status = 'matched'` ไม่ใช่แค่ `SELECT` ก่อนเขียน ดังนั้น webhook สองอันที่มาพร้อมกันปิดสองบิลด้วยเลขอ้างอิงเดียวกันไม่ได้; ส่งสลิปใบเดิมซ้ำ (หรือเลขอ้างอิงเดิม) อีกครั้งจะถูกบันทึกเป็น `rejected` และไม่ปิดบิลที่สอง
- **ยอดไม่ตรง / ตรวจไม่ผ่าน / ห้องยังไม่มีบิลค้าง** → สลิปเป็น `pending_review` เก็บ `bill_id` (บิลที่ถูกนำไปเทียบ), `bill_total` (ยอดบิลตอนเทียบ), `amount`/`trans_ref`/`verify_result` ไว้ให้เจ้าของตรวจ และ push ข้อความตรงไปตรงมาถึงผู้เช่า (ยังไม่ยืนยันว่าปิดบิล) — `verify_result.reason` เป็นคำศัพท์คงที่สำหรับคิวรอตรวจ: `mismatch | not_verified | no_unpaid_bill | duplicate_slip`; กรณีไม่มีบิลค้าง `bill_id`/`bill_total` เป็น NULL และ reason เป็น `no_unpaid_bill` — UI คิวรอตรวจเป็นของ ticket 10 (พร้อมการแจ้งเตือนเจ้าของในหัวข้อถัดไป)
- **แจ้งเจ้าของทาง LINE** — ทุกครั้งที่สลิปถูกบันทึกเป็น `pending_review` ระบบ push ถึงเจ้าของ (`settings.owner_line_user_id`) หนึ่งข้อความแบบประโยคบอกเล่า ไม่มีเครื่องหมายอัศเจรีย์: ชื่อห้อง ชื่อผู้เช่า ยอดในสลิป และยอดบิลที่นำมาเทียบ (ถ้าไม่มีบิลค้างจะบอกว่า "ยังไม่มีบิลค้างให้เทียบ" และถ้าอ่านยอดจากสลิปไม่ได้จะบอกว่า "ยอดในสลิปอ่านไม่ได้"); ยังไม่เชื่อม LINE เจ้าของ = log หนึ่งบรรทัดแล้วทำงานต่อ (ไม่ error) และ push ที่ล้มเหลวไม่ทำให้ webhook พังหรือเปลี่ยนสถานะสลิป เพราะยิงหลังเขียน DB แล้วแบบ fail-soft — ข้อความอยู่ที่ `ownerSlipPendingMessage()` ใน `src/worker/line/messages.ts`
- **ผู้ส่งที่ยังไม่เชื่อม LINE** — ไม่ดาวน์โหลด ไม่เก็บรูป ไม่สร้างแถวสลิป ตอบกลับให้พิมพ์เลขห้องก่อนส่งสลิป
- บอทไม่ log ตัวรูปหรือ secret ใดๆ ลง log มีเฉพาะ identifier แบบมีโครงสร้าง (slip id, image key, bill id, userId)

### คิวรอตรวจ (API สำหรับหน้า "รอตรวจ")

สอง endpoint นี้อยู่หลัง Access (เหมือน `/api/*` อื่น ๆ) และเป็นข้อมูลที่หน้า "รอตรวจ" ใช้ทั้งหมด (`src/worker/routes/slips-admin.ts`) ส่วน route รูป `/slips/{file}` เป็นสาธารณะเหมือนเดิม

- `GET /api/slips?status=&billId=` — เรียงใหม่สุดก่อน; **ไม่ส่ง `status` เลย = เฉพาะ `pending_review`** เพราะตัว endpoint นี้คือคิว (ถ้าส่ง `billId` แต่ไม่ส่ง `status` จะคืนทุกสถานะของบิลนั้น = ประวัติของบิล ไม่ใช่คิว); `status` รับ `pending_review | matched | rejected` ค่าอื่น `400` `field: "status"`; ส่ง `billId` คู่กับ `status` ได้; ดูบิลของสลิปด้วย `LEFT JOIN` ครั้งเดียวต่อสลิป
- payload ต่อสลิป (camelCase, `{ok: true, slips: [...]}`):

  ```json
  {
    "id": "…",
    "createdAt": "2026-09-03 03:15:12",
    "imageKey": "8f2c…c1.png",
    "imageUrl": "/slips/8f2c…c1.png",
    "status": "pending_review",
    "reason": "mismatch",
    "slipAmount": 3550.5,
    "bill": { "id": "…", "roomNumber": "A101", "tenantName": "สมชาย ใจดี", "period": "2026-09", "total": 3550 },
    "verified": true,
    "verify": { "verified": true, "transRef": "014112345678901", "date": "2026-09-03T10:15:00+07:00" },
    "transferAt": "2026-09-03T10:15:00+07:00"
  }
  ```

  - `imageUrl` = path สาธารณะ `/slips/{imageKey}` (ให้ UI ใส่ `<img>` ได้ตรง ๆ), `reason` = `verify_result.reason` (คำศัพท์คงที่), `slipAmount` = ยอดในสลิป (`NULL` เมื่ออ่านไม่ได้), `verified`/`verify` มาจากผลตรวจที่บันทึกไว้, `transferAt` = วันที่จากผู้ให้บริการ (เท่ากับ `verify.date`) ใช้เทียบ "วันเวลาโอน" ในหน้ารายละเอียด
  - `bill.total` = `slips.bill_total` ซึ่งเป็นยอดบิล **ณ ตอนที่นำสลิปไปเทียบ** (fallback ยอดบิลปัจจุบันเฉพาะกรณีที่ไม่มีค่าเก็บไว้) ส่วนชื่อห้อง/ผู้เช่า/เดือนมาจาก join กับ `bills`/`rooms`/`tenants`; `bill` เป็น `null` เมื่อสลิปไม่ได้เทียบกับบิลเลย (reason `no_unpaid_bill`) หรือบิลนั้นถูกลบไปแล้ว — ตอนตัดสินส่ง `billId` มาเองได้
  - สลิปที่ `matched` ยังเก็บ `reason` เดิมไว้ (เหตุผลที่สลิปเคยเข้าคิว) เพราะการปิดบิลจากคิวไม่ลบข้อมูลที่บันทึกไว้; สลิปที่ `rejected` มี `decision`/`decidedAt` เพิ่มใน `verify_result` ส่วนสลิปที่ปิดอัตโนมัติจากยอดตรงไม่มี `reason` เลย (`null`)
- `POST /api/slips/:id/resolve {action: "settle" | "reject", billId?}` — ตอบ `200 {ok: true, slip}` พร้อม payload ล่าสุดของสลิป (รูปเดียวกับข้างบน); สลิปที่ไม่รู้จัก `404`, สลิปที่ตัดสินไปแล้ว `409 CONFLICT`, `action` อื่น `400 field: "action"`
  - `settle` — บิลเป้าหมาย = `billId` ใน body ?? `bill_id` ของสลิป (ไม่มีทั้งคู่ `400 field: "billId"`); บิลต้องมีอยู่ (`404`) และยัง `unpaid` (`409`); `trans_ref` ของสลิปต้องไม่ถูกใช้ปิดบิลไปแล้ว (`409` — ตรวจก่อนเขียนและกันซ้ำด้วย partial unique index อีกชั้น) จากนั้น `DB.batch` เดียว: บิลเป็น `paid` (`paid_method: 'transfer'`, `paid_at` = วันที่บนสลิปเมื่อใช้ได้ ไม่งั้นใช้เวลาปัจจุบัน และมีเงื่อนไข `AND status = 'unpaid'`) + สลิปเป็น `matched` พร้อม `bill_id`/`bill_total` ของบิลนั้น แล้ว push ยืนยันถึงผู้เช่าด้วยข้อความเดียวกับตอนปิดบิลอัตโนมัติ (`slipMatchedMessage`); ถ้าบิลเพิ่งถูกปิดไปก่อนหน้าจะคืน `409` และคืนสถานะสลิปกลับเป็น `pending_review` ตามเดิม
  - `reject` — สลิปเป็น `rejected` บิลไม่เปลี่ยนอะไร และ **ไม่ push อะไรเลย**; บันทึกการตัดสินไว้ใน `verify_result` (`decision: "rejected"` + `decidedAt` เป็น ISO) โดยคงผลตรวจและ `reason` เดิมไว้
  - สลิปที่ตัดสินแล้วหายจากคิว (badge ของเมนูนับจากความยาวของ list ปกติ) แต่ยังดูย้อนหลังได้ด้วย `?billId={billId}`

## QR พร้อมเพย์ และใบแจ้งหนี้ PDF

สอง route นี้เป็น **สาธารณะ** (อยู่นอก Cloudflare Access) เพราะลิงก์ถูกส่งไปในข้อความ LINE ของผู้เช่า — อย่าเพิ่ม policy บังคับล็อกอินกับสอง path นี้ และทั้งคู่ถูกใส่ใน `assets.run_worker_first` แล้ว จึงวิ่งเข้า Worker เสมอ

- `GET /qr/:billId.png` — รูป QR พร้อมเพย์ของบิลนั้นเป็น PNG (`image/png`, `cache-control: public, max-age=60`) payload เป็น EMVCo/PromptPay ตามมาตรฐาน: พร้อมเพย์ไอดีและประเภทจาก `settings` (`phone` → sub-tag `01` รูปแบบ `0066xxxxxxxxx`, `citizen-id` → sub-tag `02` เลข 13 หลัก), ยอด = `total` ของบิล (รวมค่าใช้จ่ายเพิ่ม) ทศนิยม 2 ตำแหน่ง, สกุลเงิน `764` (THB), ประเทศ `TH` และ CRC16-CCITT (FALSE) ปิดท้าย; ยอดอ่านจากแถวบิลทุกครั้งที่เรียก แก้บิลแล้วรูปเปลี่ยนตาม; ไม่พบบิล `404` เป็น JSON; ยังไม่ได้ตั้ง `promptpay_id` ตอบ `500` (ไม่ยอมสร้าง QR ไปบัญชีอะไรก็ไม่รู้)
- `GET /invoices/:billId.pdf` — ใบแจ้งหนี้ PDF สร้างสดจาก D1 ทุกครั้ง (`application/pdf`, `cache-control: no-store`, `content-disposition: inline; filename="B2569-09-A101.pdf"`) — ไม่มีไฟล์เก็บใน R2 และไม่มีความล้าสมัยของแคช; เนื้อหาตามโครงเอกสารใบแจ้งหนี้: เลขที่ (derive แบบเดียวกับ UI `B<พ.ศ.>-<MM>-<roomNumber>`), วันที่ออก (จาก `created_at`), ชื่อหอ/เจ้าของ/พร้อมเพย์, ห้อง · ผู้เช่า, ประจำเดือน, เลขมิเตอร์น้ำ/ไฟ, ตารางรายการ (ค่าห้อง, ค่าน้ำ หน่วย × อัตรา, ค่าไฟ หน่วย × อัตรา หรือเหมาจ่าย, ค่าใช้จ่ายเพิ่มทุกบรรทัดตามชื่อจริงบนบิล), ยอดรวมทั้งสิ้น และท้ายเอกสารฝังรูป QR พร้อมเพย์ของบิลพร้อมบรรทัดบอกผู้เช่าให้ส่งสลิปกลับในแชท LINE; ยอดเงินอ่านจาก snapshot ในแถวบิลเสมอ; ไม่พบบิล `404` เป็น JSON
- ตัวเลขและฟอนต์: ทั้งสอง route ใช้ `src/worker/lib/` (payload พร้อมเพย์ + CRC16, ตัวเขียน PNG, ตัวสร้างเอกสาร, ตัวเรนเดอร์ PDF) — ฟอนต์ไทยฝังใน Worker ด้วย Wrangler module rule ชนิด `Data` สำหรับ `**/*.ttf` (`src/worker/fonts/IBMPlexSansThai-Regular.ttf` + `-Bold.ttf` จาก Google Fonts, สัญญาอนุญาต SIL OFL 1.1 ดู `src/worker/fonts/OFL.txt`) แล้ว embed ด้วย `pdf-lib` + `@pdf-lib/fontkit` แบบ subset — ฟอนต์นี้มีทั้งไทยและละติน/ตัวเลขในไฟล์เดียว จึงพิมพ์เลขที่ใบแจ้งหนี้กับยอดเงินได้ครบ (Noto Sans Thai รุ่น static ไม่มี glyph ละติน ใช้กับเอกสารที่มีตัวเลขไม่ได้); ตอน embed ปิดฟีเจอร์ `ccmp` ของฟอนต์เพื่อให้ Thai Sara Am คงรูปประกอบ (U+0E33) ทำให้ text layer ของ PDF (`pdftotext`/คัดลอกข้อความ) ได้ `ประจำเดือน` `มิเตอร์น้ำ` `ค่าน้ำ` ตรงกับต้นฉบับ ไม่ซ้ำสระ

## แดชบอร์ด

`GET /api/stats/dashboard?period=YYYY-MM` (อยู่หลัง Access เหมือน `/api/*` อื่น) คืนข้อมูลทั้งหน้าแดชบอร์ดของเดือนที่เลือกเป็น `{ok: true, period, kpis, revenue, unpaidBills, rooms}`; `period` บังคับและตรวจด้วย regex เดียวกับ route บิล (`^\d{4}-(0[1-9]|1[0-2])$`) ผิดหรือไม่ส่ง = `400 field: "period"`; อ่านข้อมูลด้วย query แบบ bounded 4 คำสั่ง (ห้อง+บิลของเดือนนั้น, บิลของเดือนนั้น, สลิป `pending_review` ของเดือนนั้น, ผลรวมบิลจ่ายแล้ว 6 เดือน) ไม่วน query ต่อห้อง

- `kpis` — `bills` (จำนวนบิลของเดือนนั้น), `dueAmount` (ผลรวม `total` ของบิลเดือนนั้น), `collectedAmount` (ผลรวมบิลที่จ่ายแล้ว), `unpaidAmount` (ผลรวมบิลที่ยังไม่จ่าย), `unpaidRooms` (จำนวนห้องที่มีบิลค้าง), `vacantRooms` (ห้องที่ไม่มีผู้เช่าปัจจุบัน), `totalRooms` (ทุกห้อง), `sentCount` (บิลที่มี `sent_at`) และ `paidCount` (บิลที่จ่ายแล้ว)
- `revenue` — 6 เดือนล่าสุดจบที่เดือนที่เลือก (ใหม่สุดอยู่ท้าย) เดือนละ `{period, amount}` โดย `amount` = ผลรวมบิลที่ **จ่ายแล้ว** ของเดือนนั้น และเติมเดือนที่ไม่มีบิลเป็น `amount: 0` เสมอ กราฟจึงมีหกแท่งครบ
- `unpaidBills` — บิลค้างของเดือนนั้น เรียงเก่าสุดก่อน (`created_at` แล้วตามด้วยเลขห้อง) แต่ละใบมี `{id, roomNumber, tenantName, total, createdAt, sentAt, hasPendingSlip}` โดย `hasPendingSlip` = มีสลิป `pending_review` ผูกกับบิลนั้น (สัญญาณว่าเจ้าของยังต้องตรวจ)
- `rooms` — ทุกห้อง เรียงตามเลขห้อง แต่ละห้อง `{id, roomNumber, status: "paid" | "unpaid" | "vacant", hasPendingSlip}` โดย `status` ตัดสินจากบิลของเดือนที่เลือก: ไม่มีผู้เช่าปัจจุบัน → `vacant`, บิลจ่ายแล้ว → `paid`, บิลค้างหรือยังไม่มีบิลแต่มีผู้เช่า → `unpaid`; `hasPendingSlip` ของห้องมาจากสลิป `pending_review` ของบิลเดือนนั้น

## Typecheck / lint / full check

```bash
npm run typecheck   # tsc --noEmit ทั้ง tsconfig.worker.json และ tsconfig.client.json
npm run lint        # eslint แบบ flat config + type-aware rules
npm run check       # typecheck + lint + test สำหรับ CI
```

## Secrets

Secrets ไม่ถูกเก็บใน repo หรือใน `wrangler.jsonc` เด็ดขาด ตอนนี้ยังไม่ได้ตั้งค่าจริงใน production รอค่าจาก LINE Official Account และ SlipOK (ใช้ครั้งแรกใน ticket 05 และ 09)

Production:

```bash
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put SLIPOK_API_KEY
npx wrangler secret put SLIPOK_BRANCH_ID
```

รหัสเชื่อมเจ้าของไม่ใช่ secret — เก็บอยู่ในตาราง `settings` ของ D1 และแสดงในหน้าตั้งค่าของแอป (กดออกรหัสใหม่ได้จากที่นั่น) จึงไม่ต้องตั้งผ่าน `wrangler secret`

`LIFF_ID` ก็ไม่ใช่ secret — เป็นค่า env ธรรมดาที่ตั้งใน `vars` ของ `wrangler.jsonc` (production) หรือ `.dev.vars` (local) เจ้าของหอใส่ LIFF ID ที่ได้จาก LINE Developers Console ที่นี่หลังสร้าง LIFF app (ดูหัวข้อ "ลงทะเบียนผู้เช่าด้วย LIFF") ปล่อยว่างไว้ก่อนได้ หน้าลงทะเบียนจะบอกให้เปิดจากในแอป LINE จนกว่าจะตั้งค่า

Local: คัดลอก `.dev.vars.example` เป็น `.dev.vars` แล้วใส่ค่าจริง ไฟล์ `.dev.vars` ถูก gitignore ไว้แล้ว หลังใส่ค่าเสร็จให้รัน `npx wrangler types` เพื่อให้ `Env` มีชื่อ secret ครบ

## LINE bot

- `POST /webhook/line` เป็น path สาธารณะ (ไม่มี Access) ตรวจ `X-Line-Signature` แบบ HMAC-SHA256 จาก raw body ก่อนทุกอย่าง ถ้า signature ไม่ถูกต้องตอบ `403` และไม่แตะฐานข้อมูล
- event `follow` → บอททักทายและขอเลขห้อง; ข้อความ text ที่ตรงกับเลขห้องของผู้เช่าปัจจุบันที่ยังไม่เชื่อม → ผูก `tenants.line_user_id`; ข้อความที่ตรงกับรหัส 6 หลักใน `settings.owner_link_code` → บันทึก `settings.owner_line_user_id`; ข้อความอื่น → เก็บในตาราง `line_pending` ให้เจ้าของจับคู่เอง
- ข้อความ text ที่ตรงกับคีย์เวิร์ดของเมนูหลัก (`ส่งสลิป` `บิลของฉัน` `ติดต่อเจ้าของ` `ลงทะเบียน`) ถูกจัดการ **ก่อน** ทุกอย่างอื่น (ตัดช่องว่างหัวท้ายแล้วเทียบแบบตรงตัว): `ส่งสลิป` → คำแนะนำให้ส่งรูปสลิปในแชท, `บิลของฉัน` → บิลล่าสุดของห้องพร้อมเดือน/ยอด/สถานะ (ผู้ใช้ที่ยังไม่เชื่อมจะได้คำแนะนำให้ลงทะเบียนพร้อมลิงก์), `ติดต่อเจ้าของ` → ชื่อและเบอร์เจ้าของจาก `owner_name`/`owner_phone` (เบอร์ว่างจะบอกว่ายังไม่ได้บันทึกเบอร์และให้ฝากคำถามไว้ในแชท), `ลงทะเบียน` → ลิงก์ลงทะเบียน (`https://liff.line.me/{LIFF_ID}` เมื่อตั้งค่า `LIFF_ID` ไม่งั้นใช้ `/register` ของ origin แอป) — ผู้ใช้ที่ยังไม่เชื่อมไม่ถูกเมิน ส่วนผู้เช่าที่เชื่อมแล้วพิมพ์คีย์เวิร์ดจะได้คำตอบแต่ข้อความอื่นของเขายังถูกเมินเหมือนเดิม
- event `message` ที่เป็นรูป (`message.type = "image"`) → ถือเป็นสลิปการโอนของห้องผู้ส่ง ไปที่หัวข้อ "สลิป และการปิดบิลอัตโนมัติ" ด้านบน (ผู้ส่งที่ยังไม่เชื่อม LINE จะได้ข้อความให้พิมพ์เลขห้องก่อน)
- `/api/line/pending` (GET) และ `/api/line/pending/:lineUserId/link` (POST) อยู่หลัง Access ใช้โดยหน้าผู้เช่าในส่วนจัดการการเชื่อม LINE
- ข้อความบิลที่บอท push เป็น Flex message ที่แนบรูป QR พร้อมเพย์และปุ่มเปิดใบแจ้งหนี้ PDF ของบิลนั้น — ทั้งคู่คือสอง route สาธารณะ `/qr/:billId.png` และ `/invoices/:billId.pdf` ด้านบน จึงต้องอยู่นอก Access
- ตอบ `200` เสมอเมื่อ signature ถูกต้อง เพื่อไม่ให้ LINE ยิงซ้ำเพราะ timeout; การเรียก LINE API ขาออกล้มเหลวได้โดยไม่ทำให้ webhook พัง

## เมนูหลักของ LINE (rich menu)

เมนูหลักของ OA `@490secnd` (channel id 2010515478) มีสี่ปุ่ม สร้างจากไฟล์ในโปรเจกต์นี้แล้วอัปโหลดขึ้น LINE ด้วยสคริปต์เดียว เป้าหมายคือแทนเมนูเดิมจากบอทบุคคลที่สามด้วยเมนูของแอปเอง

- `assets/rich-menu/rich-menu.html` — ไฟล์ต้นทางของรูป ขนาดพอดี 2500 × 1686 พิกเซล แบ่งเป็น 2 × 2 ช่อง ช่องละ 1250 × 843 ใช้ฟอนต์ไทย `IBMPlexSansThai` จาก `src/worker/fonts/` ผ่าน `@font-face` ไฟล์นี้ไม่ถูกเสิร์ฟตอนรันแอป ใช้แค่เรนเดอร์เป็นรูป
- `assets/rich-menu/rich-menu.png` — รูปที่เรนเดอร์แล้ว ขนาด 2500 × 1686 พิกเซล

ปุ่มทั้งสี่และ action:

| ช่อง | ปุ่ม | action |
|------|------|--------|
| ซ้ายบน | ลงทะเบียนผู้เช่า | `uri` → `https://liff.line.me/{LIFF_ID}` |
| ขวาบน | ส่งสลิป | `message` → `ส่งสลิป` |
| ซ้ายล่าง | บิลของฉัน | `message` → `บิลของฉัน` |
| ขวาล่าง | ติดต่อเจ้าของ | `message` → `ติดต่อเจ้าของ` |

`scripts/rich-menu.mjs` เป็น ESM ล้วน ไม่มี dependency ใช้ `LINE_CHANNEL_ACCESS_TOKEN` และ `LIFF_ID` จาก environment ก่อน ถ้าไม่มีจึงอ่านจาก `.dev.vars` ถ้าไม่มี token จะหยุดพร้อมข้อความบอก ถ้าไม่มี `LIFF_ID` จะไม่สร้างเมนูเพราะปุ่มลงทะเบียนจะกลายเป็นลิงก์ตาย สคริปต์พิมพ์แค่ id ไม่เคยพิมพ์ token (รันผ่าน `npm run` หรือ `node scripts/rich-menu.mjs` ก็ได้)

```bash
npm run rich-menu                              # สร้างเมนู + อัปโหลดรูป + ตั้งเป็นเมนูหลักของทุกคน
npm run rich-menu:list                         # ดูเมนูทั้งหมดของ OA
npm run rich-menu:delete -- richmenu-xxxxxxxx  # ลบเมนูตาม richMenuId
```

`npm run rich-menu` เรียก `POST /v2/bot/richmenu` แล้ว `POST /v2/bot/richmenu/{richMenuId}/content` ที่โฮสต์ `api-data.line.me` แล้วปิดท้ายด้วย `POST /v2/bot/user/all/richmenu/{richMenuId}` ถ้าขั้นไหนล้มเหลวจะพิมพ์ HTTP status และ body ที่ LINE ตอบกลับมาให้เห็นว่า LINE ไม่รับตรงไหน

ข้อความตอบกลับของปุ่มแบบ `message` (`ส่งสลิป` `บิลของฉัน` `ติดต่อเจ้าของ`) และคำสั่งพิมพ์เอง `ลงทะเบียน` อยู่ในฝั่ง webhook (`handleTextMessage` ใน `src/worker/routes/line.ts`) แยกจากสคริปต์นี้ ข้อความทั้งหมดสร้างจาก `src/worker/line/messages.ts`

### เรนเดอร์รูปเมนูใหม่

เมื่อแก้ `rich-menu.html` แล้วต้องสร้าง `rich-menu.png` ใหม่ ให้เปิดไฟล์ด้วยเบราว์เซอร์ที่ viewport ขนาด 2500 × 1686 พิกเซลพอดี แล้วบันทึกภาพ ต้องเห็นฟอนต์ไทยถูกต้อง ไม่มีสระหรือวรรณยุกต์ลอย (เช่นใช้ `agent-browser` เปิด `file://` แล้ว `set viewport 2500 1686` จากนั้น `screenshot`)

## ลงทะเบียนผู้เช่าด้วย LIFF

ผู้เช่าเปิดลิงก์ LIFF จากในแชท LINE กรอกชื่อ-นามสกุล เบอร์โทร และเลือกห้องที่ว่าง ระบบยืนยันตัวตนด้วย access token ของ LIFF ฝั่งเซิร์ฟเวอร์ แล้วสร้างผู้เช่า ผูก LINE แจ้งเจ้าของ และยืนยันกลับให้ผู้เช่า — เจ้าของไม่ต้องกรอกข้อมูลเอง

### หน้าลงทะเบียน (สาธารณะ)

- `GET /register` — หน้าฟอร์ม LIFF เป็น HTML เดี่ยว (ไม่ใช่ SPA และไม่ผูกกับเปลือกแอป) โหลด LIFF SDK แล้ว `liff.init({ liffId })` โดยอ่าน LIFF ID จาก env `LIFF_ID` แล้ว `liff.getAccessToken()`; ถ้า `LIFF_ID` ว่าง เปิดนอกแอป LINE หรือ init ไม่สำเร็จ จะแสดงข้อความภาษาไทยให้เปิดจากในแอป LINE เท่านั้น พร้อมขั้นตอนตั้งค่าที่เจ้าของต้องทำ — ไม่มีหน้าจอพังหรือเงียบ
- ฟอร์มมี ชื่อ-นามสกุล / เบอร์โทร / ห้อง (dropdown จาก `GET /api/register/rooms` โหลดใหม่ทุกครั้งที่เปิดหน้า) ปุ่มส่งที่มีสถานะกำลังทำงาน การตรวจค่าในหน้าแบบ inline และหน้าสำเร็จที่โชว์ชื่อ+ห้องพร้อมปุ่ม `liff.closeWindow()`; ข้อความ error จากเซิร์ฟเวอร์ (`409`/`401`) แสดงในหน้าและให้แก้ไขส่งใหม่ได้ — หน้าออกแบบตาม `DESIGN.md` ด้วยชุดสีของแอป (พื้นโทนกระดาษ เส้นขอบ 1px มุมโค้ง และปุ่มหลักสีเข้มทึบ) ใช้ฟอนต์ไทยชุดเดียวกับแอป (Inter + Noto Sans Thai) และไม่มี dependency/ขั้นตอน build
- หน้าอยู่ก่อน SPA fallback ด้วยการเพิ่ม `/register` ใน `assets.run_worker_first`

### Endpoints (สาธารณะ)

- `GET /api/register/rooms` — คืน `{ ok: true, rooms: [{ id, roomNumber }] }` เฉพาะห้องที่ว่าง เรียงตามเลขห้อง ไม่มีชื่อผู้เช่า ค่าเช่า หรือข้อมูลอื่นติดออกไป
- `POST /api/register` — body `{ name, phone, roomId, accessToken }`; ตรวจค่าก่อนแตะฐานข้อมูล (ชื่อ ≥ 2 ตัวอักษร, เบอร์โทรไทย 10 หลักเริ่มด้วย 0 โดยตัดช่องว่าง/ขีดออก, `roomId` และ `accessToken` ต้องไม่ว่าง) → `400` พร้อม `field`; แล้วเรียก `GET https://api.line.me/v2/profile` ด้วย `Authorization: Bearer {accessToken}` เพื่อยืนยันตัวตน **ฝั่งเซิร์ฟเวอร์เสมอ ไม่รับ userId จาก body** (ล้มเหลวทุกกรณี → `401` "ลิงก์ยืนยันตัวตนไม่ถูกต้อง กรุณาเปิดฟอร์มจาก LINE อีกครั้ง" และไม่สร้างอะไร) ใช้ `userId` ที่ได้เป็นตัวตน; LINE ที่ผูกกับผู้เช่าอยู่แล้ว → `409` (บอกเลขห้องในข้อความ); ไม่พบห้อง → `404`; ห้องที่มีผู้เช่าอยู่แล้ว → `409`
- เมื่อผ่านทุกข้อ: สร้างผู้เช่าด้วยกฎเดียวกับ `POST /api/tenants` (วันเข้า = วันนี้, ห้องเป็น `occupied`, ผ่าน partial unique index หนึ่งผู้เช่าปัจจุบันต่อห้อง) พร้อมลบแถว `line_pending` ของผู้ใช้นั้นใน `DB.batch` เดียว → แล้ว (หลัง commit, แบบ fail-soft) push `ผู้เช่าลงทะเบียนใหม่: {ชื่อ} ห้อง {เลขห้อง} เบอร์ {เบอร์}` ถึงเจ้าของ (เฉพาะเมื่อมี `settings.owner_line_user_id`; ล้มเหลวไม่ทำให้คำขอพัง) และ push ข้อความยืนยันสั้นๆ ถึงผู้เช่า → ตอบ `200 { ok: true, tenant: { name, roomNumber } }`; ความล้มเหลว log แบบมีโครงสร้าง
- อยู่ **นอก Cloudflare Access** เหมือน `/webhook/*`, `/qr/*` และ `/slips/*` เพราะเปิดจากใน LINE ก่อนผู้ใช้ล็อกอินได้ — `/api/*` glob ครอบ `/api/register/*` อยู่แล้ว ส่วน `/register` ถูกใส่ใน `run_worker_first` และต้องเพิ่มใน Access bypass ด้วย

### ขั้นตอนที่เจ้าของทำใน LINE Developers Console

1. สร้าง LIFF app ผูกกับ LINE Login channel ของหอพัก
2. ตั้ง Endpoint URL เป็น `https://wangchan-dorm.nodhk2545.workers.dev/register`
3. ตั้งขนาดเป็น Full และเพิ่ม scope `profile` (จำเป็นต่อการได้ access token ที่ยืนยันตัวตนได้)
4. ก๊อป LIFF ID ที่ได้ไปใส่ค่า env `LIFF_ID` (production: `vars` ใน `wrangler.jsonc` แล้ว deploy ใหม่; local: `.dev.vars`) — ว่างไว้ก่อนได้ หน้าลงทะเบียนจะบอกให้เปิดจากใน LINE จนกว่าจะตั้งค่า

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
4. แยก path ที่ต้องเปิดสาธารณะออกจาก Access: `/webhook/*` (LINE เรียกเข้ามา), `/qr/*` และ `/invoices/*` (ลิงก์รูป QR และใบแจ้งหนี้ PDF ที่ฝังในข้อความ LINE), `/slips/*` (ให้ SlipOK ดึงรูปสลิปไปตรวจ) และ `/register` + `/api/register/*` (หน้าลงทะเบียนผู้เช่าที่เปิดจากในแอป LINE ก่อนผู้ใช้ล็อกอินได้) — เช่นใช้ Bypass policy ตาม path

`/slips/*` **ต้องอยู่นอก Access เสมอ**: ถ้าถูกบังคับล็อกอิน SlipOK จะดึงรูปไปตรวจไม่ได้ (ได้หน้า login แทนรูป) และการปิดบิลอัตโนมัติจะหยุดทำงานทั้งระบบ เหตุผลเดียวกับ `/qr/*` และ `/invoices/*` ที่ลิงก์ถูกส่งออกไปนอกแอป — ความลับของรูปคือคีย์สุ่ม 128-bit ที่เดาไม่ได้ ไม่ใช่การบังคับล็อกอิน

การจัดการ asset และ API:

- `assets.run_worker_first` เป็น array ของ glob `["/api/*", "/health", "/webhook/*", "/qr/*", "/slips/*", "/invoices/*", "/register"]` ทำให้ path เหล่านี้วิ่งเข้า Worker เสมอ ส่วน path อื่นถูกเสิร์ฟเป็น static asset และ fallback เป็น SPA (`not_found_handling: "single-page-application"`) — `/register` ต้องอยู่ในลิสต์นี้ ไม่งั้นจะได้ `index.html` ของ SPA แทนหน้าลงทะเบียน
- ถ้าเพิ่ม path API ใหม่ ต้องเพิ่ม glob ใน `assets.run_worker_first` ด้วย ไม่งั้นจะได้ index.html แทน JSON

## โครงสร้างไฟล์

```
src/worker/       Hono app (index.ts) และ routes (health, rooms, tenants, bills, settings, line, register, seam-probe, bills-render, slips, slips-admin, stats)
src/worker/line/  signature (HMAC-SHA256), LINE Messaging API client, SlipOK client และข้อความภาษาไทย
src/worker/lib/   ตรรกะที่ไม่ผูกกับ request: promptpay (payload + CRC16), png, qr, invoice (ตัวสร้างเอกสาร), pdf, slips (รับสลิป + แจ้งเจ้าของ)
src/worker/fonts/ ฟอนต์ไทยสำหรับ PDF (IBM Plex Sans Thai Regular/Bold, OFL 1.1)
src/client/       React SPA (main.tsx, App.tsx, api.ts, styles.css)
src/client/pages/ หน้าจอแต่ละหน้า (rooms, tenants, settings, bills, dashboard, ...)
migrations/       D1 migrations
seed/             ข้อมูลตัวอย่าง (rooms.sql, tenants.sql, settings.sql)
test/             vitest + @cloudflare/vitest-pool-workers
design/           prototype UX/UI (ไฟล์อ้างอิง ไม่ได้ build)
docs/             spec และ ADR
assets/           ไฟล์ต้นทางรูป rich menu (rich-menu.html + rich-menu.png, ไม่ได้ build)
scripts/          สคริปต์สำหรับผู้ดูแล (rich-menu.mjs)
```

## หมายเหตุเรื่อง UI

โครง app ตอนนี้ mirror จาก `design/index.html` (เวอร์ชันล่าสุด) — search bar, ปุ่มแจ้งเตือน และ Ctrl K ใน topbar เป็นโครง UI เปล่ายังไม่ทำงานจริง เพราะยังไม่มี ticket ที่รองรับ

## Notes on versions

- `vitest` ถูก pin ที่ v4 เพราะ `@cloudflare/vitest-pool-workers` กำหนด peer ไว้ที่ `vitest ^4.1.0`
- v0.22.0 ของ pool ใช้ miniflare/workerd ที่เก่ากว่า `compatibility_date` ของโปรเจกต์ จึงกำหนด `overrides.miniflare` ใน `package.json` ให้ตรงกับ miniflare ที่ wrangler 4.131.1 ใช้ เพื่อให้เทสต์รันด้วย workerd ตัวเดียวกับตอน dev และ deploy
