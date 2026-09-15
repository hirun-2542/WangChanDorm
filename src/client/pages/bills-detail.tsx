import { type Bill } from "../api";
import { PageHeader, StatusBadge } from "../ui";
import { InvoicePreview, LineStateBadge, baht, periodLabel, stampLabel, toInvoice, type PaymentRecord } from "./bills-shared";

export interface BillDetailProps {
  bill: Bill;
  dormName: string | null;
  connected: boolean | null;
  onBack: () => void;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-steel">{label}</span>
      <span className="num text-charcoal">{value}</span>
    </div>
  );
}

function paymentHistory(bill: Bill): PaymentRecord[] {
  if (bill.status !== "paid" || bill.paidAt === null) {
    return [];
  }

  return [{ method: bill.paidMethod ?? "ไม่ระบุ", when: stampLabel(bill.paidAt), note: "ปิดบิลแล้ว" }];
}

export function BillDetail({ bill, dormName, connected, onBack }: BillDetailProps) {
  const history = paymentHistory(bill);
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
        title={`บิลห้อง ${bill.roomNumber}`}
        supporting={`${bill.tenantName} · ${periodLabel(bill.period)} · เลขที่บิล ${bill.id}`}
        actions={<StatusBadge status={bill.status} />}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <InvoicePreview data={toInvoice(bill)} dormName={dormName} />

        <aside className="card lg:sticky lg:top-20">
          <h2 className="text-[15px] text-charcoal">การจัดการบิล</h2>
          <p className="mt-1.5 text-sm text-steel">การแก้ไข ปิดบิล และลบบิล จะมาในงานถัดไป</p>

          <div className="mt-4 border-t border-ash pt-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm text-charcoal">สถานะ LINE</h3>
              <LineStateBadge sentAt={bill.sentAt} connected={connected} />
            </div>
            <p className="mt-1.5 text-xs text-fog">
              {bill.sentAt === null ? "ยังไม่ได้ส่งบิลทาง LINE" : `ส่งล่าสุด ${stampLabel(bill.sentAt)}`}
            </p>
          </div>

          {isPaid && (
            <div className="mt-4 border-t border-ash pt-4">
              <h3 className="text-sm text-charcoal">ข้อมูลการชำระเงิน</h3>
              <div className="mt-2 grid gap-2">
                <InfoRow label="ช่องทาง" value={bill.paidMethod ?? "ไม่ระบุ"} />
                <InfoRow label="เวลาที่ปิดบิล" value={bill.paidAt === null ? "ไม่ระบุ" : stampLabel(bill.paidAt)} />
              </div>
            </div>
          )}

          <div className="mt-4 border-t border-ash pt-4">
            <h3 className="text-sm text-charcoal">ประวัติการชำระ</h3>
            {history.length === 0 ? (
              <p className="mt-1.5 text-xs text-fog">ยังไม่มีประวัติการชำระ บิลนี้ยังไม่ปิด</p>
            ) : (
              <ul className="mt-2 grid gap-2">
                {history.map((entry) => (
                  <li key={entry.when} className="rounded-lg border border-ash px-3 py-2">
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
