import { useState } from "react";
import { ApiError, sendBill, type Bill } from "../api";
import { Button, PageHeader, StatusBadge } from "../ui";
import {
  InvoicePreview,
  LineStateBadge,
  baht,
  billNumber,
  dateLabel,
  paidMethodLabel,
  periodLabel,
  stampLabel,
  toInvoice,
  type PaymentRecord,
} from "./bills-shared";
import { BillEditDrawer, DeleteBillDialog, MarkPaidDialog } from "./bills-actions";

export interface BillDetailProps {
  bill: Bill;
  dormName: string | null;
  ownerName: string | null;
  promptpayId: string | null;
  connected: boolean | null;
  onBack: () => void;
  onSaved: (bill: Bill) => void;
  onSent: (bill: Bill) => void;
  onSendError: (message: string) => void;
  onDeleted: () => void;
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

  return [{ method: paidMethodLabel(bill.paidMethod), when: stampLabel(bill.paidAt), note: "ปิดบิลด้วยมือ" }];
}

export function BillDetail({
  bill,
  dormName,
  ownerName,
  promptpayId,
  connected,
  onBack,
  onSaved,
  onSent,
  onSendError,
  onDeleted,
}: BillDetailProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const history = paymentHistory(bill);
  const isPaid = bill.status === "paid";
  const number = billNumber(bill);
  const sendBlockedReason = connected === null ? "ยังไม่ทราบสถานะ LINE ของผู้เช่า" : "ผู้เช่ายังไม่เชื่อม LINE";

  const handleSend = () => {
    if (connected === false || sending) {
      return;
    }

    setSending(true);

    void sendBill(bill.id)
      .then((updated) => {
        onSent(updated);
      })
      .catch((error: unknown) => {
        onSendError(error instanceof ApiError ? error.message : "ส่งบิลทาง LINE ไม่สำเร็จ");
      })
      .finally(() => {
        setSending(false);
      });
  };

  const handleSaved = (updated: Bill) => {
    setEditOpen(false);
    setPayOpen(false);
    onSaved(updated);
  };

  const handleDeleted = () => {
    setDeleteOpen(false);
    onDeleted();
  };

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
        supporting={`${bill.tenantName} · ${periodLabel(bill.period)} · เลขที่บิล ${number}`}
        actions={<StatusBadge status={bill.status} />}
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <InvoicePreview
          data={toInvoice(bill)}
          dormName={dormName}
          meta={{
            ownerName,
            promptpayId,
            number,
            issueDate: dateLabel(bill.createdAt),
          }}
        />

        <aside className="card lg:sticky lg:top-20">
          {isPaid ? (
            <div>
              <h2 className="text-[15px] text-charcoal">ข้อมูลการชำระเงิน</h2>
              <div className="mt-3 grid gap-2">
                <InfoRow label="ช่องทาง" value={paidMethodLabel(bill.paidMethod)} />
                <InfoRow label="เวลาที่ปิดบิล" value={bill.paidAt === null ? "ไม่ระบุ" : stampLabel(bill.paidAt)} />
                <InfoRow label="ยอดที่ชำระ" value={`${baht(bill.total)} บาท`} />
              </div>
              <p className="mt-3 text-xs text-fog">บิลที่จ่ายแล้วแก้ไขหรือลบไม่ได้</p>
            </div>
          ) : (
            <div>
              <h2 className="text-[15px] text-charcoal">การจัดการบิล</h2>
              <p className="mt-1.5 text-sm text-steel">แก้ไขมิเตอร์และค่าใช้จ่าย ปิดบิลด้วยมือ หรือลบบิลที่ยังไม่จ่าย</p>

              <div className="mt-4 grid gap-2">
                <Button
                  variant="secondary"
                  icon="send"
                  className="w-full justify-start"
                  disabled={connected === false || sending}
                  title={connected === false || connected === null ? sendBlockedReason : undefined}
                  onClick={handleSend}
                >
                  {sending ? "กำลังส่งบิล" : "ส่ง LINE อีกครั้ง"}
                </Button>
                {connected === false ? (
                  <p className="text-[11px] text-fog">{sendBlockedReason}</p>
                ) : (
                  <p className="text-[11px] text-fog">
                    {bill.sentAt === null ? "ยังไม่ได้ส่งบิลนี้ทาง LINE" : `ส่งล่าสุด ${stampLabel(bill.sentAt)}`}
                  </p>
                )}

                <Button
                  variant="secondary"
                  icon="edit"
                  className="mt-2 w-full justify-start"
                  onClick={() => {
                    setEditOpen(true);
                  }}
                >
                  แก้ไขบิล
                </Button>
                <Button
                  variant="primary"
                  icon="check_circle"
                  className="w-full justify-start"
                  onClick={() => {
                    setPayOpen(true);
                  }}
                >
                  ปิดบิลด้วยมือ
                </Button>
                <Button
                  variant="danger-soft"
                  icon="delete"
                  className="mt-2 w-full justify-start"
                  onClick={() => {
                    setDeleteOpen(true);
                  }}
                >
                  ลบบิล
                </Button>
              </div>
            </div>
          )}

          <div className="mt-4 border-t border-ash pt-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm text-charcoal">สถานะ LINE</h3>
              <LineStateBadge sentAt={bill.sentAt} connected={connected} />
            </div>
            <p className="mt-1.5 text-xs text-fog">
              {bill.sentAt === null ? "ยังไม่ได้ส่งบิลทาง LINE" : `ส่งล่าสุด ${stampLabel(bill.sentAt)}`}
            </p>
          </div>

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

      <BillEditDrawer
        open={editOpen}
        bill={bill}
        onClose={() => {
          setEditOpen(false);
        }}
        onSaved={handleSaved}
      />

      <MarkPaidDialog
        open={payOpen}
        bill={bill}
        onClose={() => {
          setPayOpen(false);
        }}
        onPaid={handleSaved}
      />

      <DeleteBillDialog
        open={deleteOpen}
        bill={bill}
        onClose={() => {
          setDeleteOpen(false);
        }}
        onDeleted={handleDeleted}
      />
    </div>
  );
}
