import type { ReactNode } from "react";

interface PlaceholderProps {
  icon: string;
  title: string;
  description: string;
  children?: ReactNode;
}

function Placeholder({ icon, title, description, children }: PlaceholderProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <span className="ms grid h-16 w-16 place-items-center rounded-2xl bg-soft text-[32px] text-primary">
          {icon}
        </span>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="max-w-lg text-sm text-muted">{description}</p>
        {children}
      </div>
    </div>
  );
}

export function DashboardPage() {
  return (
    <Placeholder
      icon="space_dashboard"
      title="Dashboard"
      description="ภาพรวมยอดที่ควรเก็บ เก็บแล้ว ค้างชำระ และสถานะห้องทั้งหอในหน้าเดียว"
    />
  );
}

export function RoomsPage() {
  return (
    <Placeholder
      icon="door_front"
      title="ห้องพัก"
      description="เพิ่มและแก้ไขห้องพัก เห็นสถานะ ว่าง/มีผู้เช่า และอัตราน้ำไฟของแต่ละห้อง"
    />
  );
}

export function TenantsPage() {
  return (
    <Placeholder
      icon="group"
      title="ผู้เช่า"
      description="เพิ่มและแก้ไขข้อมูลผู้เช่า ดูประวัติการย้ายออก และจับคู่บัญชี LINE"
    />
  );
}

export function BillsPage() {
  return (
    <Placeholder
      icon="receipt_long"
      title="บิล"
      description="สร้างบิลรายเดือนจากเลขมิเตอร์ ตรวจสถานะการจ่าย และส่งยอดให้ผู้เช่าทาง LINE"
    >
      <a className="text-sm font-semibold text-primary-deep" href="#line">
        ดูตัวอย่างข้อความที่บอทส่งให้ผู้เช่า →
      </a>
    </Placeholder>
  );
}

export function ReviewPage() {
  return (
    <Placeholder
      icon="fact_check"
      title="รอตรวจสลิป"
      description="ตรวจสลิปที่ยอดไม่ตรงหรือ EasySlip ตรวจไม่ผ่าน ก่อนปิดบิลให้ผู้เช่า"
    />
  );
}

export function LinePage() {
  return (
    <Placeholder
      icon="chat_bubble"
      title="ข้อความ LINE"
      description="ดูตัวอย่างข้อความที่ระบบส่งให้ผู้เช่าในแต่ละเหตุการณ์"
    />
  );
}

export function SettingsPage() {
  return (
    <Placeholder
      icon="settings"
      title="ตั้งค่า"
      description="กำหนดข้อมูลหอ อัตราน้ำไฟ พร้อมเพย์ และการเชื่อมต่อกับ LINE"
    />
  );
}
