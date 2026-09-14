import { useEffect, useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Toast, type BadgeTone } from "../ui";
import { reviewQueue, type ReviewReason, type SlipReview } from "../mock-data";
import { baht } from "./bills-shared";

type FilterId = "all" | "mismatch" | "failed";

const filterOptions: { id: FilterId; label: string }[] = [
  { id: "all", label: "ทั้งหมด" },
  { id: "mismatch", label: "ยอดไม่ตรง" },
  { id: "failed", label: "ตรวจไม่ผ่าน" },
];

const reasonByFilter: Record<Exclude<FilterId, "all">, ReviewReason> = {
  mismatch: "ยอดไม่ตรง",
  failed: "ตรวจไม่ผ่าน",
};

function easySlipTone(state: string): BadgeTone {
  return state === "สลิปจริง" ? "paid" : "danger";
}

function slipAmountLabel(amount: number | null): string {
  return amount === null ? "ไม่มียอด" : `${baht(amount)} บาท`;
}

function SlipThumb() {
  return (
    <span className="grid h-14 w-14 shrink-0 place-items-center gap-0.5 rounded-lg border border-ash bg-paper-mist text-center">
      <span className="ms text-[20px] text-silver" aria-hidden="true">
        receipt_long
      </span>
      <span className="text-[10px] leading-none text-fog">ตัวอย่าง</span>
    </span>
  );
}

interface FilterTabsProps {
  value: FilterId;
  onChange: (value: FilterId) => void;
}

function FilterTabs({ value, onChange }: FilterTabsProps) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-ash p-1" role="group" aria-label="ตัวกรองสลิปรอตรวจ">
      {filterOptions.map((option) => {
        const active = option.id === value;

        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            className={`btn ${active ? "bg-paper-mist text-charcoal" : "text-steel"}`}
            onClick={() => {
              onChange(option.id);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function ReviewPage() {
  const [items, setItems] = useState<SlipReview[]>(() => reviewQueue.map((item) => ({ ...item })));
  const [filter, setFilter] = useState<FilterId>("all");
  const [selectedId, setSelectedId] = useState<string | null>(() => reviewQueue[0]?.id ?? null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (toast === null) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 2800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const visible = items.filter((item) => filter === "all" || item.reason === reasonByFilter[filter]);
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0] ?? null;
  const mismatchCount = items.filter((item) => item.reason === "ยอดไม่ตรง").length;
  const failedCount = items.filter((item) => item.reason === "ตรวจไม่ผ่าน").length;

  const resolve = (item: SlipReview, message: string) => {
    const next = items.filter((entry) => entry.id !== item.id);
    setItems(next);
    setSelectedId(next[0]?.id ?? null);
    setToast(message);
  };

  return (
    <div>
      <PageHeader
        title="รอตรวจ"
        supporting={`${items.length} รายการรอตรวจ · ยอดไม่ตรง ${mismatchCount} · ตรวจไม่ผ่าน ${failedCount}`}
        actions={<FilterTabs value={filter} onChange={setFilter} />}
      />

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon="check_circle"
            title="ไม่มีสลิปรอตรวจ"
            description="สลิปที่ยอดไม่ตรงหรือ EasySlip ตรวจไม่ผ่าน พร้อมยอดเทียบก่อนปิดบิล จะแสดงที่นี่"
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Card className="lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto">
            <CardHeader title="คิวสลิป" description={`แสดง ${visible.length} จาก ${items.length} รายการ`} />
            {visible.length === 0 ? (
              <p className="py-6 text-center text-sm text-fog">ไม่พบสลิปที่ตรงกับตัวกรองที่เลือก</p>
            ) : (
              <ul className="grid gap-2">
                {visible.map((item) => {
                  const active = item.id === selected?.id;

                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          setSelectedId(item.id);
                        }}
                        className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                          active ? "border-pebble bg-paper-mist" : "border-ash hover:bg-paper-mist"
                        }`}
                      >
                        <SlipThumb />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-charcoal">ห้อง {item.roomId}</span>
                            <span className="chip">{item.reason}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-fog">{item.tenantName}</span>
                          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-steel">
                            <span>
                              สลิป <span className="num text-charcoal">{slipAmountLabel(item.slipAmount)}</span>
                            </span>
                            <span>
                              บิล <span className="num text-charcoal">{baht(item.billAmount)} บาท</span>
                            </span>
                          </span>
                          <span className="mt-1 block text-[11px] text-fog">ส่งเมื่อ {item.submittedAt}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {selected === null ? (
            <Card>
              <EmptyState
                icon="fact_check"
                title="ยังไม่ได้เลือกสลิป"
                description="เลือกสลิปจากคิวด้านซ้ายเพื่อดูรายละเอียดและเทียบยอดก่อนปิดบิล"
              />
            </Card>
          ) : (
            <Card>
              <CardHeader
                title={`สลิปห้อง ${selected.roomId}`}
                description={`${selected.tenantName} · ส่งเมื่อ ${selected.submittedAt}`}
                actions={<Badge tone="neutral">ตัวอย่าง</Badge>}
              />

              <div className="grid gap-3">
                <div className="panel-muted">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-charcoal">สลิปโอนเงินที่ส่งมา</span>
                    <Badge tone="neutral">ตัวอย่าง</Badge>
                  </div>
                  <div className="mt-3 grid h-40 place-items-center rounded-lg border border-ash bg-canvas-white text-center">
                    <span>
                      <span className="ms block text-[32px] text-silver" aria-hidden="true">
                        receipt_long
                      </span>
                      <span className="mt-1 block text-xs text-fog">ตัวอย่างสลิป ไม่ใช่ภาพจริง</span>
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-fog">
                    {selected.bank ?? "ไม่ระบุธนาคาร"} · โอนเมื่อ {selected.transferredAt ?? "ไม่พบเวลาธุรกรรม"}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg border border-ash px-3 py-2">
                  <span className="text-sm text-steel">ผลตรวจจาก EasySlip</span>
                  <Badge tone={easySlipTone(selected.easySlipState)} icon="verified">
                    {selected.easySlipState}
                  </Badge>
                </div>

                <div className="rounded-lg border border-ash p-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-fog">ยอดโอนจากสลิป</p>
                      <p className="num mt-1 text-lg text-charcoal">
                        {selected.slipAmount === null ? "—" : baht(selected.slipAmount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-fog">ยอดบิล</p>
                      <p className="num mt-1 text-lg text-charcoal">{baht(selected.billAmount)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-fog">ผลต่าง</p>
                      <p
                        className={`num mt-1 text-lg ${
                          selected.delta === null ? "text-fog" : selected.delta === 0 ? "text-vivid-green" : "text-danger"
                        }`}
                      >
                        {selected.delta === null
                          ? "ตรวจไม่ได้"
                          : `${selected.delta > 0 ? "+" : ""}${baht(selected.delta)} บาท`}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 border-t border-ash pt-3">
                    <p className="text-xs text-fog">บิลที่นำมาเทียบ</p>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-charcoal">
                        ห้อง {selected.roomId} · {selected.tenantName}
                      </span>
                      <a href="#bills" className="text-sm">
                        ดูบิล
                      </a>
                    </div>
                    <p className="mt-0.5 text-xs text-fog">เลขที่บิล {selected.billId}</p>
                  </div>
                </div>

                <p className="text-xs text-steel">
                  ระบบเทียบยอดสลิปกับบิลล่าสุดของห้องนี้แล้ว ตรวจทานยอดให้ตรงก่อนตัดสินใจ
                </p>

                <div className="flex flex-wrap justify-end gap-2 border-t border-ash pt-3">
                  <Button
                    variant="danger-soft"
                    icon="block"
                    onClick={() => {
                      resolve(selected, `ปฏิเสธสลิปห้อง ${selected.roomId} แล้ว`);
                    }}
                  >
                    ปฏิเสธสลิป
                  </Button>
                  <Button
                    variant="primary"
                    icon="task_alt"
                    onClick={() => {
                      resolve(selected, `ปิดบิลห้อง ${selected.roomId} ด้วยสลิปนี้แล้ว`);
                    }}
                  >
                    ปิดบิลด้วยสลิปนี้
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      <Toast message={toast ?? ""} open={toast !== null} />
    </div>
  );
}
