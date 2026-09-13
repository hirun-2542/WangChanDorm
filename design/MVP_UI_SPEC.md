# Wang Chan Dorm — MVP UI/UX Specification

> Theme: Clean Premium SaaS — white / soft blue / minimal / spacious / easy to scan
> Source of truth: `docs/specs/0001-dorm-mvp.md`
> Interactive reference: `design/index.html`

## 1. Design Direction

เป้าหมายคือให้เจ้าของหอสามารถใช้งานได้เร็วแม้ไม่ถนัดระบบหลังบ้าน โดยทุกหน้าต้องเน้น “เห็นสถานะก่อน แล้วค่อยลงมือทำ”

### Visual language
- Background: `#F7FAFF`
- Surface: `#FFFFFF`
- Primary: `#1677FF`
- Primary hover: `#0F63DB`
- Primary soft: `#EAF3FF`
- Text primary: `#10213D`
- Text secondary: `#60708A`
- Border: `#E6EDF7`
- Success: `#16A36A`
- Warning: `#F59E0B`
- Danger: `#EF4444`
- LINE: `#06C755`
- Radius card: `16px`
- Radius input/button: `10px`
- Shadow: `0 4px 18px rgba(34,78,135,.06)`
- Font: `IBM Plex Sans Thai`
- Desktop content max width: `1440px`
- Sidebar width: `220–240px`
- Main spacing: `24px` desktop / `16px` mobile

### UX principles
1. Primary action ต่อหน้าไม่เกิน 1 จุดที่เด่นที่สุด
2. สถานะใช้ทั้งสี + text ห้ามใช้สีอย่างเดียว
3. ตารางต้อง scan ได้เร็ว ตัวเลขชิดขวา และใช้ tabular numbers
4. งานต้นเดือนต้องทำได้จากหน้าเดียวให้มากที่สุด
5. destructive action ต้องมี confirmation
6. mobile ใช้ bottom navigation เฉพาะเมนูหลัก ส่วน action สำคัญให้ sticky ด้านล่าง
7. ทุกหน้าต้องมี empty / loading / error state
8. ข้อมูลเก่า เช่น บิลที่ปิดแล้ว ต้องดูได้แต่แก้ไม่ได้

---

# 2. Global Shell

## Desktop

### Left sidebar
- Logo + `Wang Chan Dorm`
- Dashboard
- ห้องพัก
- ผู้เช่า
- บิล
  - สร้างบิล
  - รายการบิล
- รอตรวจ
- ข้อความ LINE
- ตั้งค่า

Badge ที่ `รอตรวจ` แสดงจำนวนรายการ pending

### Top bar
- Search: `ค้นหาห้อง, ผู้เช่า, เบอร์โทร...`
- Notification icon
- Owner avatar + name
- Optional shortcut `Ctrl K`

## Mobile
- Header: current page title + actions
- Bottom tabs:
  - Dashboard
  - ห้องพัก
  - ผู้เช่า
  - บิล
  - เพิ่มเติม
- `เพิ่มเติม` เปิด sheet: รอตรวจ / ข้อความ LINE / ตั้งค่า

---

# 3. Page Inventory

## P01 — Dashboard

### Goal
เจ้าของเห็นสถานะหอและการเงินใน 5–10 วินาที

### Header
- `Dashboard`
- Month selector
- CTA: `สร้างบิลเดือนนี้`

### KPI cards
1. ยอดที่ควรเก็บ
2. เก็บแล้ว
3. ค้างชำระ
4. ห้องว่าง

แต่ละ card มี icon + value + supporting text เช่น `12/15 บิล`

### Main content
- Revenue chart 6 เดือน
- Payment completion donut/progress
- บิลค้างชำระ เรียงเก่าสุดก่อน
- Room status grid
  - เขียว = จ่ายแล้ว
  - น้ำเงิน = ยังไม่จ่าย
  - เทา = ว่าง
  - ส้ม = มีสลิปรอตรวจ

### Quick actions
- สร้างบิล
- ดูบิลค้าง
- ตรวจสลิป

### Mobile
KPI 2-column → chart → overdue list → room grid

---

## P02 — ห้องพัก / Rooms

### Header
- `ห้องพัก`
- Summary: `24 ห้อง · มีผู้เช่า 21 · ว่าง 3`
- CTA `+ เพิ่มห้อง`

### Toolbar
- Search room / tenant
- Filter: ทั้งหมด / มีผู้เช่า / ว่าง
- View: Table / Cards

### Recommended default
Desktop = table เพราะข้อมูลเยอะและแก้เร็ว
Mobile = cards

### Table columns
- ห้อง
- สถานะ
- ผู้เช่า
- ค่าเช่า
- ค่าน้ำ
- ค่าไฟ
- มิเตอร์ล่าสุด
- Action `...`

### Room row details
ถ้ามี custom utility rate ให้ badge `อัตราพิเศษ`

### Add/Edit room drawer
Fields:
- เลขห้อง
- ค่าเช่า / เดือน
- มิเตอร์น้ำเริ่มต้น
- มิเตอร์ไฟเริ่มต้น
- ค่าน้ำ
  - ใช้อัตราทั้งหอ
  - กำหนดเอง
- ค่าไฟ
  - ใช้อัตราทั้งหอ
  - กำหนดเอง

Default rate ต้องแสดงค่าจริงใน helper text เช่น `ใช้อัตราทั้งหอ 20 บาท/หน่วย`

### Empty state
`ยังไม่มีห้องพัก` + `เพิ่มห้องแรก`

---

## P03 — ผู้เช่า / Tenants

### Header
- `ผู้เช่า`
- Tabs: `ปัจจุบัน` / `ย้ายออกแล้ว`
- CTA `+ เพิ่มผู้เช่า`

### Attention card
ถ้ามี LINE pending pairing:
`มี 2 คนที่แอด LINE แล้วแต่ยังจับคู่ไม่ได้`
CTA `จัดการการเชื่อม LINE`

### Table columns
- ผู้เช่า
- ห้อง
- เบอร์โทร
- วันที่เข้า
- LINE
- สถานะ
- Action

### LINE status
- `เชื่อมแล้ว`
- `ยังไม่เชื่อม`
- helper: `ให้ผู้เช่าแอดบอทและพิมพ์เลขห้อง`

### Tenant detail drawer
- Profile information
- Room
- Check-in date
- LINE status
- Recent bills
- Button `แก้ไข`
- Danger action `เช็คเอาท์`

### Checkout modal
- วันที่ออก
- Warning: ห้องจะเปลี่ยนเป็นว่าง แต่ประวัติผู้เช่าจะยังถูกเก็บ

---

## P04 — LINE Pending Pairing

สามารถเป็น section / modal จากหน้าผู้เช่า ไม่จำเป็นต้องมี sidebar item

### Layout
- Pending user list ซ้าย
- Match tenant panel ขวา

ข้อมูล pending:
- LINE display name
- ข้อความล่าสุด
- เวลา

Action:
- เลือกผู้เช่า
- `จับคู่ LINE`

Success state:
`เชื่อม LINE กับ คุณ... ห้อง A101 สำเร็จ`

---

## P05 — บิล / Bill List

### Header
- `บิล`
- Month selector
- CTA `+ สร้างบิล`

### Summary strip
- จำนวนบิล
- จ่ายแล้ว
- ยังไม่จ่าย
- ยอดรวม

### Filters
- Search room / tenant
- Status: ทั้งหมด / ยังไม่จ่าย / จ่ายแล้ว
- LINE: ทั้งหมด / ส่งแล้ว / ส่งไม่ได้

### Table columns
- ห้อง / ผู้เช่า
- ค่าห้อง
- ค่าน้ำ
- ค่าไฟ
- รวม
- สถานะ
- LINE
- Action

### Row action
Unpaid:
- ดูบิล
- แก้ไข
- ส่ง LINE ซ้ำ
- ปิดบิลด้วยมือ
- ลบบิล

Paid:
- ดูบิล
- ดูประวัติชำระ

ห้ามแสดง edit/delete แบบ enabled สำหรับ paid bill

---

# P06 — สร้างบิล / Create Bill

นี่คือหน้าหลักที่ต้องยึดหน้าตา reference ล่าสุด

## 3-step wizard
1. `กรอกข้อมูลมิเตอร์`
2. `ตรวจสอบและยืนยัน`
3. `ส่งบิล`

### Top section
- รอบบิล
- status `ยังไม่สร้างบิล`
- optional due date UI ให้ซ่อนใน MVP เพราะ spec ระบุ due date out of scope
- CTA utility `ตั้งค่าอัตราน้ำ/ไฟ`

### KPI summary
- ห้องทั้งหมดที่มีผู้เช่า
- กรอกครบ
- ยังไม่กรอก
- มีข้อผิดพลาด
- ประมาณการยอดรวม

### Toolbar
- Search
- Status filter: ทั้งหมด / พร้อม / ยังไม่กรอก / error
- meter filter
- View table/card

### Main meter table
Columns:
- checkbox
- ห้อง
- ผู้เช่า
- ค่าเช่า
- น้ำ: ครั้งก่อน / ครั้งนี้ / หน่วย / เงิน
- ไฟ: ครั้งก่อน / ครั้งนี้ / หน่วย / เงิน
- ยอดรวม
- สถานะ

### Interaction rules
- Current meter editable inline
- Previous meter read-only
- Units + amount calculate instantly
- current < previous → red field + error icon + disable next
- Empty meter → status `ยังไม่กรอก`
- custom room rate → small badge `อัตราพิเศษ`

### Preview panel desktop
Right panel sticky:
- Invoice preview of currently selected/active room
- Dorm info
- Bill month
- Room + tenant
- Charge breakdown
- Total
- PromptPay QR

Mobile: preview opens bottom sheet `ดูตัวอย่างบิล`

### Sticky summary bar
- selected rooms
- rent total
- water total
- electric total
- grand total
- secondary `บันทึกฉบับร่าง`
- primary `ตรวจสอบและยืนยัน →`

Important: ถ้า MVP backend ไม่มี draft จริง ให้ UI ไม่แสดง `บันทึกฉบับร่าง` ตอน implementation จริง จนกว่าจะเพิ่ม contract รองรับ

---

## P07 — ตรวจสอบบิลก่อนสร้าง

### Header
- Stepper step 2 active
- `ตรวจสอบและยืนยัน`

### Summary
- `จะสร้าง 21 บิล`
- total amount
- LINE connected count
- LINE unconnected count

### Warnings
- ผู้เช่าที่ยังไม่เชื่อม LINE
- meter anomaly ที่ถูก override ไม่ควรมีใน MVP: anomaly ต้องแก้ก่อนเสมอ

### Review table
- Room
- Tenant
- Rent
- Water
- Electric
- Total
- LINE state

### Footer
- `ย้อนกลับแก้ไข`
- `สร้างบิล 21 รายการ`

การสร้างบิลกับการส่ง LINE ควรแยก action เพื่อไม่ให้ accidental push:
1. `สร้างบิล`
2. success screen → `ส่ง LINE ทั้งหมด`

---

## P08 — Create Bill Success / Send Bills

### Success header
`สร้างบิลเรียบร้อย`

### Result cards
- สร้างแล้ว X
- ยอดรวม
- พร้อมส่ง LINE X
- ส่งไม่ได้ X

### Unconnected list
ห้องที่ไม่มี LINE พร้อมข้อความ copy ได้:
`กรุณาแอด LINE ของหอและพิมพ์เลขห้อง...`

### CTA
Primary `ส่ง LINE ทั้งหมด`
Secondary `กลับรายการบิล`

หลังส่ง:
- success count
- failed count
- retry action เฉพาะ failed

---

## P09 — รายละเอียดบิล / Bill Detail

### Header
- Bill number
- Room / tenant / period
- Status badge

### Main two-column
Left: invoice
Right: actions/payment information

### Invoice
- Dorm information
- Room + tenant
- Rent
- Water: previous → current, units × rate
- Electric: previous → current, units × rate
- Total
- PromptPay QR exact amount

### Action panel unpaid
- `ส่ง LINE อีกครั้ง`
- `แก้ไขบิล`
- `ปิดบิลด้วยมือ`
- `ลบบิล`

### Action panel paid
- payment method
- paid timestamp
- slip preview if available
- no edit/delete

---

## P10 — Manual Mark Paid

Modal from bill detail

Fields:
- ช่องทาง: `โอน` / `เงินสด`
- วันที่รับเงิน default วันนี้

Confirm button:
`ยืนยันปิดบิล`

After success LINE confirmation is pushed when tenant has LINE connection.

---

## P11 — รอตรวจสลิป / Review Queue

### Header
- `รอตรวจ`
- pending count

### Filters
- ทั้งหมด
- ยอดไม่ตรง
- ตรวจไม่ผ่าน

### Recommended desktop layout
Master-detail
- left 40% = list
- right 60% = selected slip detail

### Queue row
- Slip thumbnail
- Room
- Tenant
- Slip amount
- Bill amount
- reason
- submitted time

### Detail
- Large slip image
- EasySlip state
- transferred amount
- bill amount
- delta
- transaction date/time
- bill being compared

### Actions
- `ปิดบิลด้วยสลิปนี้`
- `ปฏิเสธสลิป`

Never use `approve` without showing amount comparison.

### Empty
`ไม่มีสลิปรอตรวจ` + check icon

---

## P12 — ข้อความ LINE / Message Reference

MVP นี้ไม่ใช่ chat inbox เต็มรูปแบบ หน้านี้เป็น reference/preview ของข้อความระบบ

Tabs:
1. `บิลรายเดือน`
2. `ยืนยันการชำระ`
3. `สลิปรอตรวจ — เจ้าของ`
4. `สรุปหลังส่งบิล — เจ้าของ`
5. `เชื่อม LINE สำเร็จ`

Desktop layout:
- event list left
- phone preview right

Each preview shows:
- actual Thai copy
- variables highlighted lightly e.g. `{room}`, `{total}`

---

## P13 — ตั้งค่า / Settings

Use vertical sub-navigation on desktop or stacked sections mobile.

### Section A — ข้อมูลหอ
- ชื่อหอ
- ชื่อเจ้าของ

### Section B — ค่าน้ำ/ค่าไฟ
- default water rate
- default electricity rate
- note: existing bill snapshots do not change

### Section C — PromptPay
- type: phone / citizen/company ID
- PromptPay ID
- account display name
- QR preview sample (ไม่ใช้เงินจริง)

### Section D — LINE เจ้าของ
- state connected / not connected
- 6-digit pairing code
- `ออกรหัสใหม่`
- warning old code revoked immediately

### Section E — Integrations status
- LINE Messaging API
- EasySlip

Do not expose API keys in UI.

### Sticky save
Desktop bottom/right `บันทึกการตั้งค่า`
Mobile bottom sticky

---

# 4. Dialogs / Drawers Required

1. Add room
2. Edit room
3. Add tenant
4. Edit tenant
5. Checkout tenant
6. Pair LINE manually
7. Manual mark paid
8. Delete unpaid bill confirmation
9. Regenerate owner pairing code confirmation
10. Send bill confirmation (only when bulk send)

Prefer Drawer for edit-heavy forms; Modal for confirmations.

---

# 5. Global States

## Loading
Use skeleton rows/cards, avoid full-screen spinner except initial app boot.

## Empty
Always explain next action.
Example:
- `ยังไม่มีบิลเดือนนี้`
- CTA `สร้างบิลเดือนนี้`

## Error
Show message close to failing element.
For API-level error use toast + persistent inline state if action is blocked.

## Offline / request failed
Do not pretend action succeeded. Keep user inputs intact and expose retry.

---

# 6. Responsive Rules

## ≥ 1280px
- sidebar fixed
- full table
- create bill: table + 320–360px sticky preview

## 768–1279px
- compact sidebar
- horizontal-scroll tables only when unavoidable
- preview drawer

## < 768px
- bottom navigation
- cards replace dense tables where practical
- create bill room-by-room card editor
- sticky bottom CTA
- minimum touch target 44px

---

# 7. Accessibility

- Contrast >= WCAG AA
- Every icon-only button has accessible label
- Keyboard navigation works for table controls and dialogs
- Focus state visible
- Error messages connected to input
- Do not encode payment status with color only

---

# 8. Implementation Priority

## Phase 1 — Core shell
1. Design tokens
2. App shell + responsive nav
3. Shared Card / Badge / Button / Input / Table / Dialog

## Phase 2 — Core operations
4. Rooms
5. Tenants
6. Create Bill wizard
7. Bill List + Bill Detail

## Phase 3 — Payments
8. Review Queue
9. Manual mark paid
10. LINE previews

## Phase 4 — Monitoring/config
11. Dashboard
12. Settings

---

# 9. MVP Consistency Notes

- Do not add tenant portal.
- Do not add cron / automatic monthly bill creation.
- Do not add late fee, due date, installment or deposit workflow to MVP.
- Create bills only for occupied rooms.
- Paid bills are immutable.
- Water/electric values and rates are snapshotted into each bill.
- Slip auto-close only when EasySlip succeeds AND amount matches latest unpaid bill for sender.
- Mismatch / verification failure goes to Review Queue.
- Tenant LINE identity belongs to tenant, not room.

This file is the visual/interaction source of truth for implementing the MVP theme chosen by the user.