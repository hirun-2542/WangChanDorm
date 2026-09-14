import type { Bill } from "../mock-data";
import { Badge, Button, PageHeader, StatusBadge } from "../ui";
import { InvoicePreview, LineStateBadge, baht, toInvoice, type PaymentRecord } from "./bills-shared";

export interface BillDetailProps {
  bill: Bill;
  history: PaymentRecord[];
  pendingSend: boolean;
  onBack: () => void;
  onResend: (bill: Bill) => void;
  onEdit: (bill: Bill) => void;
  onMarkPaid: (bill: Bill) => void;
  onDelete: (bill: Bill) => void;
}

function SlipPreview({ amount }: { amount: number }) {
  return (
    <div className="rounded-xl border border-ash p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-steel">สลิปการโอน</span>
        <Badge tone="neutral">ตัวอย่าง</Badge>
      </div>
      <div className="mt-2 grid h-28 place-items-center rounded-lg bg-paper-mist text-slate" aria-hidden="true">
        <span className="ms text-[32px]">receipt_long</span>
      </div>
      <p className="num mt-2 text-center text-xs text-fog">ตัวอย่างภาพสลิป · {baht(amount)} บาท</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-steel">{label}</span>
      <span className="num text-charcoal">{value}</span>
    </div>
  );
}

export function BillDetail({ bill, history, pendingSend, onBack, onResend, onEdit, onMarkPaid, onDelete }: BillDetailProps) {
  const latest = history.length > 0 ? history[history.length - 1] : undefined;
  const isPaid = bill.status === "paid";

  return (
    <div>
      <button type="button" className="btn btn-ghost btn-sm mb-3" onClick={onBack}>
        <span className="ms text-[18px]" aria-hidden="true">
          arrow_back
        </span>
        กลับรายการบิล
      </button>

      <PageHeader
        title={`บิลห้อง ${bill.roomId}`}
        supporting={`${bill.tenantName} · ${bill.period} · เลขที่บิล ${bill.id}`}
        actions={<StatusBadge status={bill.status} />}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <InvoicePreview data={toInvoice(bill)} />

        <aside className="card lg:sticky lg:top-20">
          <h2 className="text-[15px] text-charcoal">การจัดการบิล</h2>
          <p className="mt-0.5 text-xs text-fog">
            {isPaid ? "บิลนี้ปิดแล้ว จึงแก้ไขหรือลบไม่ได้" : "บิลยังไม่ชำระ จึงแก้ไขหรือลบได้"}
          </p>

          {!isPaid && (
            <div className="mt-4 grid gap-2">
              <Button
                variant="secondary"
                icon="chat_bubble"
                className="w-full justify-center"
                disabled={pendingSend}
                onClick={() => {
                  onResend(bill);
                }}
              >
                {pendingSend ? "กำลังส่ง LINE" : "ส่ง LINE อีกครั้ง"}
              </Button>
              <Button
                variant="secondary"
                icon="edit"
                className="w-full justify-center"
                onClick={() => {
                  onEdit(bill);
                }}
              >
                แก้ไขบิล
              </Button>
              <Button
                variant="primary"
                icon="payments"
                className="w-full justify-center"
                onClick={() => {
                  onMarkPaid(bill);
                }}
              >
                ปิดบิลด้วยมือ
              </Button>
              <Button
                variant="danger-soft"
                icon="delete"
                className="w-full justify-center"
                onClick={() => {
                  onDelete(bill);
                }}
              >
                ลบบิล
              </Button>
            </div>
          )}

          <div className="mt-4 border-t border-ash pt-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm text-charcoal">สถานะ LINE</h3>
              <LineStateBadge bill={bill} />
            </div>
            <p className="mt-1.5 text-xs text-fog">
              {bill.lineSentAt === null ? "ยังไม่ได้ส่งบิลทาง LINE" : `ส่งล่าสุด ${bill.lineSentAt}`}
            </p>
          </div>

          {isPaid && (
            <div className="mt-4 border-t border-ash pt-4">
              <h3 className="text-sm text-charcoal">ข้อมูลการชำระเงิน</h3>
              <div className="mt-2 grid gap-2">
                <InfoRow label="ช่องทาง" value={latest === undefined ? "ไม่ระบุ" : latest.method} />
                <InfoRow label="เวลาที่ปิดบิล" value={latest === undefined ? "ไม่ระบุ" : latest.when} />
              </div>
              {latest !== undefined && latest.hasSlip && (
                <div className="mt-3">
                  <SlipPreview amount={bill.total} />
                </div>
              )}
            </div>
          )}

          <div className="mt-4 border-t border-ash pt-4">
            <h3 className="text-sm text-charcoal">ประวัติการชำระ</h3>
            {history.length === 0 ? (
              <p className="mt-1.5 text-xs text-fog">ยังไม่มีประวัติการชำระ บิลนี้ยังไม่ปิด</p>
            ) : (
              <ul className="mt-2 grid gap-2">
                {history.map((entry, index) => (
                  <li key={`${entry.when}-${index}`} className="rounded-lg border border-ash px-3 py-2">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-charcoal">{entry.method}</span>
                      <span className="num text-charcoal">{baht(bill.total)} บาท</span>
                    </div>
                    <p className="num mt-0.5 text-[11px] text-fog">{entry.when}</p>
                    <p className="mt-0.5 text-[11px] text-fog">{entry.note}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
