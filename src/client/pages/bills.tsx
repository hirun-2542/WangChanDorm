import { useCallback, useEffect, useState } from "react";
import { useSearch } from "../search";
import {
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  PageHeader,
  Select,
  StatBlock,
  StatusBadge,
  Toast,
  type PageProps,
} from "../ui";
import { type Bill, type ExtraCharge } from "../mock-data";
import {
  LineStateBadge,
  baht,
  lineStateOf,
  nowLabel,
  periods,
  seedBills,
  seedPayments,
  tenantById,
  todayIso,
  type PaymentRecord,
} from "./bills-shared";
import { BillDetail } from "./bills-detail";
import { CreateWizard } from "./bills-create";

interface BillListProps {
  bills: Bill[];
  pendingSendId: string | null;
  onOpen: (bill: Bill) => void;
  onResend: (bill: Bill) => void;
  onEdit: (bill: Bill) => void;
  onMarkPaid: (bill: Bill) => void;
  onDelete: (bill: Bill) => void;
  onCreate: () => void;
}

function BillList({ bills, pendingSendId, onOpen, onResend, onEdit, onMarkPaid, onDelete, onCreate }: BillListProps) {
  const { query, setQuery } = useSearch();
  const [period, setPeriod] = useState<string>(periods[0]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [lineFilter, setLineFilter] = useState("all");
  const [actionBill, setActionBill] = useState<Bill | null>(null);

  const monthBills = bills.filter((bill) => bill.period === period);
  const paidCount = monthBills.filter((bill) => bill.status === "paid").length;
  const unpaidCount = monthBills.length - paidCount;
  const monthTotal = monthBills.reduce((sum, bill) => sum + bill.total, 0);

  const needle = query.trim().toLowerCase();
  const filtered = monthBills.filter((bill) => {
    const matchesQuery = needle === "" || bill.roomId.toLowerCase().includes(needle) || bill.tenantName.toLowerCase().includes(needle);
    const matchesStatus = statusFilter === "all" || bill.status === statusFilter;
    const lineState = lineStateOf(bill);
    const matchesLine = lineFilter === "all" || (lineFilter === "sent" ? lineState === "sent" : lineState === "blocked");
    return matchesQuery && matchesStatus && matchesLine;
  });

  const columns = [
    {
      key: "room",
      header: "ห้อง / ผู้เช่า",
      render: (bill: Bill) => (
        <button type="button" className="text-left" onClick={() => onOpen(bill)}>
          <span className="block font-medium text-charcoal hover:underline">{bill.roomId}</span>
          <span className="block text-xs text-fog">{bill.tenantName}</span>
        </button>
      ),
    },
    { key: "rent", header: "ค่าห้อง", align: "right" as const, render: (bill: Bill) => baht(bill.rent) },
    { key: "water", header: "ค่าน้ำ", align: "right" as const, render: (bill: Bill) => baht(bill.waterAmount) },
    { key: "electric", header: "ค่าไฟ", align: "right" as const, render: (bill: Bill) => baht(bill.electricAmount) },
    {
      key: "extra",
      header: "ค่าใช้จ่ายเพิ่ม",
      align: "right" as const,
      render: (bill: Bill) => {
        const extraTotal = bill.extraCharges.reduce((sum, charge) => sum + charge.amount, 0);
        return extraTotal === 0 ? <span className="text-fog">—</span> : baht(extraTotal);
      },
    },
    {
      key: "total",
      header: "รวม",
      align: "right" as const,
      render: (bill: Bill) => <span className="font-medium">{baht(bill.total)}</span>,
    },
    { key: "status", header: "สถานะ", render: (bill: Bill) => <StatusBadge status={bill.status} /> },
    { key: "line", header: "LINE", render: (bill: Bill) => <LineStateBadge bill={bill} /> },
    {
      key: "action",
      header: "จัดการ",
      align: "right" as const,
      render: (bill: Bill) => (
        <div className="flex justify-end gap-2">
          {bill.status === "unpaid" ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => onOpen(bill)}>
                ดูบิล
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setActionBill(bill)}>
                จัดการ
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => onOpen(bill)}>
                ดูบิล
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onOpen(bill);
                }}
              >
                ดูประวัติชำระ
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="บิล"
        supporting={`${period} · ${monthBills.length} ใบ · จ่ายแล้ว ${paidCount} · ยังไม่จ่าย ${unpaidCount}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="field-label mb-0" htmlFor="bills-period">
              รอบบิล
            </label>
            <select
              id="bills-period"
              className="input w-auto"
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value);
              }}
            >
              {periods.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <Button variant="primary" icon="add" onClick={onCreate}>
              สร้างบิล
            </Button>
          </div>
        }
      />

      <Card className="mb-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatBlock label="จำนวนบิล" value={`${monthBills.length} ใบ`} supporting={period} />
          <StatBlock label="จ่ายแล้ว" value={String(paidCount)} />
          <StatBlock label="ยังไม่จ่าย" value={String(unpaidCount)} />
          <StatBlock label="ยอดรวม" value={`${baht(monthTotal)} บาท`} />
        </div>
      </Card>

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full md:hidden sm:w-60">
            <Field label="ค้นหาห้องหรือผู้เช่า" value={query} onChange={setQuery} placeholder="เช่น A103 หรือ ธนา" />
          </div>
          <div className="w-full sm:w-40">
            <Select
              label="สถานะบิล"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: "ทั้งหมด" },
                { value: "unpaid", label: "ยังไม่จ่าย" },
                { value: "paid", label: "จ่ายแล้ว" },
              ]}
            />
          </div>
          <div className="w-full sm:w-40">
            <Select
              label="สถานะ LINE"
              value={lineFilter}
              onChange={setLineFilter}
              options={[
                { value: "all", label: "ทั้งหมด" },
                { value: "sent", label: "ส่งแล้ว" },
                { value: "blocked", label: "ส่งไม่ได้" },
              ]}
            />
          </div>
        </div>
      </Card>

      {monthBills.length === 0 ? (
        <Card>
          <EmptyState
            icon="receipt_long"
            title="ยังไม่มีบิลเดือนนี้"
            description="เริ่มสร้างบิลทั้งหอจากการกรอกเลขมิเตอร์ แล้วส่งทาง LINE ได้ในครั้งเดียว"
            action={
              <Button variant="primary" icon="add" onClick={onCreate}>
                สร้างบิลเดือนนี้
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="hidden md:block">
            <DataTable columns={columns} rows={filtered} getRowKey={(bill) => bill.id} minWidth={900} emptyMessage="ไม่พบบิลที่ตรงกับเงื่อนไข" />
          </Card>

          <div className="grid gap-3 md:hidden">
            {filtered.length === 0 && <Card>
              <EmptyState icon="receipt_long" title="ไม่พบบิลที่ตรงกับเงื่อนไข" description="ลองล้างคำค้นหาหรือเปลี่ยนตัวกรองสถานะ" />
            </Card>}
            {filtered.map((bill) => (
              <Card key={bill.id}>
                <div className="flex items-start justify-between gap-3">
                  <button type="button" className="min-w-0 text-left" onClick={() => onOpen(bill)}>
                    <span className="block font-medium text-charcoal">{bill.roomId}</span>
                    <span className="block text-xs text-fog">{bill.tenantName}</span>
                  </button>
                  <StatusBadge status={bill.status} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-sm text-steel">ยอดรวม</span>
                  <span className="num text-lg text-charcoal">{baht(bill.total)} บาท</span>
                </div>
                <div className="mt-2">
                  <LineStateBadge bill={bill} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => onOpen(bill)}>
                    ดูบิล
                  </Button>
                  {bill.status === "unpaid" ? (
                    <Button size="sm" variant="secondary" onClick={() => setActionBill(bill)}>
                      จัดการ
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => onOpen(bill)}>
                      ดูประวัติชำระ
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <Dialog
        open={actionBill !== null}
        onClose={() => {
          setActionBill(null);
        }}
        title={actionBill === null ? "จัดการบิล" : `จัดการบิล · ห้อง ${actionBill.roomId}`}
        footer={
          <Button
            variant="ghost"
            onClick={() => {
              setActionBill(null);
            }}
          >
            ปิด
          </Button>
        }
      >
        {actionBill !== null && (
          <div className="grid gap-2">
            <Button
              variant="secondary"
              icon="receipt_long"
              className="w-full justify-start"
              onClick={() => {
                onOpen(actionBill);
                setActionBill(null);
              }}
            >
              ดูบิล
            </Button>
            <Button
              variant="secondary"
              icon="chat_bubble"
              className="w-full justify-start"
              disabled={pendingSendId === actionBill.id}
              onClick={() => {
                onResend(actionBill);
                setActionBill(null);
              }}
            >
              {pendingSendId === actionBill.id ? "กำลังส่ง LINE" : "ส่ง LINE ซ้ำ"}
            </Button>
            <Button
              variant="secondary"
              icon="edit"
              className="w-full justify-start"
              onClick={() => {
                onEdit(actionBill);
                setActionBill(null);
              }}
            >
              แก้ไขบิล
            </Button>
            <Button
              variant="secondary"
              icon="payments"
              className="w-full justify-start"
              onClick={() => {
                onMarkPaid(actionBill);
                setActionBill(null);
              }}
            >
              ปิดบิลด้วยมือ
            </Button>
            <Button
              variant="danger-soft"
              icon="delete"
              className="w-full justify-start"
              onClick={() => {
                onDelete(actionBill);
                setActionBill(null);
              }}
            >
              ลบบิล
            </Button>
          </div>
        )}
      </Dialog>
    </div>
  );
}

interface EditBillDialogProps {
  bill: Bill | null;
  onClose: () => void;
  onSave: (bill: Bill) => void;
}

function EditBillDialog({ bill, onClose, onSave }: EditBillDialogProps) {
  const [waterCurrent, setWaterCurrent] = useState("");
  const [electricCurrent, setElectricCurrent] = useState("");
  const [flatAmount, setFlatAmount] = useState("");
  const [extras, setExtras] = useState<ExtraCharge[]>([]);
  const [seededId, setSeededId] = useState<string | null>(null);

  if (bill !== null && bill.id !== seededId) {
    setSeededId(bill.id);
    setWaterCurrent(String(bill.waterCurrent));
    setElectricCurrent(bill.electricCurrent === null ? "" : String(bill.electricCurrent));
    setFlatAmount(String(bill.electricAmount));
    setExtras(bill.extraCharges.map((extra) => ({ ...extra })));
  }

  if (bill === null) {
    return (
      <Dialog open={false} onClose={onClose} title="แก้ไขบิล">
        {null}
      </Dialog>
    );
  }

  const isFlat = bill.electricMode === "flat";
  const waterValue = Number(waterCurrent);
  const waterInvalid = waterCurrent.trim() === "" || !Number.isFinite(waterValue) || waterValue < bill.waterPrevious;
  const waterUnits = waterInvalid ? 0 : waterValue - bill.waterPrevious;
  const waterAmount = waterUnits * bill.waterRate;

  const electricPrevious = bill.electricPrevious ?? 0;
  const electricValue = Number(electricCurrent);
  const electricInvalid = !isFlat && (electricCurrent.trim() === "" || !Number.isFinite(electricValue) || electricValue < electricPrevious);
  const electricUnits = isFlat ? 0 : electricInvalid ? 0 : electricValue - electricPrevious;
  const flatValue = Number(flatAmount);
  const electricAmount = isFlat ? (Number.isFinite(flatValue) ? flatValue : 0) : electricUnits * bill.electricRate;

  const extrasTotal = extras.reduce((sum, extra) => sum + (Number.isFinite(extra.amount) ? extra.amount : 0), 0);
  const total = bill.rent + waterAmount + electricAmount + extrasTotal;
  const canSave = !waterInvalid && !electricInvalid;

  const save = () => {
    onSave({
      ...bill,
      waterCurrent: waterValue,
      waterUnits,
      waterAmount,
      electricCurrent: isFlat ? null : electricValue,
      electricUnits: isFlat ? null : electricUnits,
      electricAmount,
      extraCharges: extras.filter((extra) => extra.label.trim() !== "").map((extra) => ({ label: extra.label.trim(), amount: extra.amount })),
      total: bill.rent + waterAmount + electricAmount + extras.filter((extra) => extra.label.trim() !== "").reduce((sum, extra) => sum + extra.amount, 0),
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`แก้ไขบิล · ห้อง ${bill.roomId}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button variant="primary" icon="save" disabled={!canSave} onClick={save}>
            บันทึกการแก้ไข
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="text-sm text-steel">
          {bill.tenantName} · {bill.period}
        </p>

        <Field
          label={`มิเตอร์น้ำครั้งนี้ (ครั้งก่อน ${bill.waterPrevious})`}
          value={waterCurrent}
          onChange={setWaterCurrent}
          inputMode="numeric"
          error={waterInvalid ? "ต้องไม่น้อยกว่ามิเตอร์ครั้งก่อน" : undefined}
          helper={waterInvalid ? undefined : `${waterUnits} หน่วย × ${bill.waterRate} = ${baht(waterAmount)} บาท`}
        />

        {isFlat ? (
          <Field
            label="ค่าไฟเหมาจ่าย (บาท)"
            value={flatAmount}
            onChange={setFlatAmount}
            inputMode="numeric"
            helper="ห้องนี้คิดค่าไฟแบบเหมาจ่ายรายเดือน"
          />
        ) : (
          <Field
            label={`มิเตอร์ไฟครั้งนี้ (ครั้งก่อน ${bill.electricPrevious ?? 0})`}
            value={electricCurrent}
            onChange={setElectricCurrent}
            inputMode="numeric"
            error={electricInvalid ? "ต้องไม่น้อยกว่ามิเตอร์ครั้งก่อน" : undefined}
            helper={electricInvalid ? undefined : `${electricUnits} หน่วย × ${bill.electricRate} = ${baht(electricUnits * bill.electricRate)} บาท`}
          />
        )}

        <div>
          <span className="field-label">ค่าใช้จ่ายเพิ่มเติม</span>
          {extras.length === 0 && <p className="text-xs text-fog">ยังไม่มีค่าใช้จ่ายเพิ่มเติม</p>}
          <div className="grid gap-2">
            {extras.map((extra, index) => (
              <div key={`extra-${index}`} className="flex items-end gap-2">
                <div className="flex-1">
                  <input
                    className="input"
                    value={extra.label}
                    aria-label={`ชื่อค่าใช้จ่ายรายการที่ ${index + 1}`}
                    placeholder="เช่น ค่าอินเทอร์เน็ต"
                    onChange={(event) => {
                      setExtras((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, label: event.target.value } : item)));
                    }}
                  />
                </div>
                <div className="w-28">
                  <input
                    className="input num text-right"
                    inputMode="numeric"
                    value={String(extra.amount)}
                    aria-label={`จำนวนเงินค่าใช้จ่ายรายการที่ ${index + 1}`}
                    onChange={(event) => {
                      setExtras((prev) =>
                        prev.map((item, itemIndex) => (itemIndex === index ? { ...item, amount: Number(event.target.value) } : item)),
                      );
                    }}
                  />
                </div>
                <IconButton
                  icon="delete"
                  label={`ลบค่าใช้จ่ายรายการที่ ${index + 1}`}
                  onClick={() => {
                    setExtras((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
                  }}
                />
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            icon="add"
            className="mt-2"
            onClick={() => {
              setExtras((prev) => [...prev, { label: "", amount: 0 }]);
            }}
          >
            เพิ่มค่าใช้จ่าย
          </Button>
        </div>

        <div className="card flex items-center justify-between gap-3 bg-paper-mist">
          <span className="text-sm text-charcoal">ยอดรวมหลังแก้ไข</span>
          <span className="num text-lg text-charcoal">{baht(total)} บาท</span>
        </div>
      </div>
    </Dialog>
  );
}

interface MarkPaidDialogProps {
  bill: Bill | null;
  today: string;
  onClose: () => void;
  onConfirm: (bill: Bill, method: "โอน" | "เงินสด", date: string) => void;
}

function MarkPaidDialog({ bill, today, onClose, onConfirm }: MarkPaidDialogProps) {
  const [method, setMethod] = useState<"โอน" | "เงินสด">("โอน");
  const [date, setDate] = useState(today);
  const [seededId, setSeededId] = useState<string | null>(null);

  if (bill !== null && bill.id !== seededId) {
    setSeededId(bill.id);
    setMethod("โอน");
    setDate(today);
  }

  if (bill === null) {
    return (
      <Dialog open={false} onClose={onClose} title="ยืนยันปิดบิล">
        {null}
      </Dialog>
    );
  }

  const methods: ("โอน" | "เงินสด")[] = ["โอน", "เงินสด"];

  return (
    <Dialog
      open
      onClose={onClose}
      title="ยืนยันปิดบิล"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            icon="payments"
            onClick={() => {
              onConfirm(bill, method, date);
            }}
          >
            ยืนยันปิดบิล
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="text-sm text-steel">
          ห้อง {bill.roomId} · {bill.tenantName} · ยอด {baht(bill.total)} บาท
        </p>

        <div>
          <span className="field-label">ช่องทางการชำระ</span>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-ash p-1" role="group" aria-label="ช่องทางการชำระ">
            {methods.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={method === option}
                className={`btn justify-center ${method === option ? "bg-paper-mist text-charcoal" : "text-steel"}`}
                onClick={() => {
                  setMethod(option);
                }}
              >
                {method === option && (
                  <span className="ms text-[16px]" aria-hidden="true">
                    check
                  </span>
                )}
                {option}
              </button>
            ))}
          </div>
        </div>

        <Field label="วันที่รับเงิน" type="date" value={date} onChange={setDate} />

        <div className="panel-muted">
          <p className="text-sm text-charcoal">หลังยืนยัน</p>
          <p className="mt-1 text-sm text-steel">บิลจะเปลี่ยนเป็น “จ่ายแล้ว” และแก้ไขหรือลบไม่ได้อีก</p>
          <p className="mt-1 text-xs text-fog">
            {tenantById.get(bill.tenantId)?.lineLinked === true
              ? "ผู้เช่าเชื่อม LINE แล้ว ระบบจะส่งข้อความยืนยันการชำระให้อัตโนมัติ"
              : "ผู้เช่ายังไม่เชื่อม LINE จึงจะไม่ได้รับข้อความยืนยัน"}
          </p>
        </div>
      </div>
    </Dialog>
  );
}

interface DeleteBillDialogProps {
  bill: Bill | null;
  onClose: () => void;
  onConfirm: (bill: Bill) => void;
}

function DeleteBillDialog({ bill, onClose, onConfirm }: DeleteBillDialogProps) {
  if (bill === null) {
    return (
      <Dialog open={false} onClose={onClose} title="ลบบิล">
        {null}
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="ลบบิล"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            variant="danger-soft"
            icon="delete"
            onClick={() => {
              onConfirm(bill);
            }}
          >
            ลบบิล
          </Button>
        </>
      }
    >
      <p className="text-sm text-steel">
        ลบบิลห้อง {bill.roomId} ประจำเดือน {bill.period} ยอด {baht(bill.total)} บาท ออกถาวร การลบย้อนกลับไม่ได้
      </p>
    </Dialog>
  );
}

export function BillsPage({ view }: PageProps) {
  const [bills, setBills] = useState<Bill[]>(() => seedBills);
  const [payments, setPayments] = useState<Record<string, PaymentRecord[]>>(() => seedPayments(seedBills));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<Bill | null>(null);
  const [payTarget, setPayTarget] = useState<Bill | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Bill | null>(null);
  const [pendingSendId, setPendingSendId] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
  }, []);

  useEffect(() => {
    if (toast === null) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 3000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const go = (hash: string) => {
    window.location.hash = hash;
  };

  const openDetail = (bill: Bill) => {
    setSelectedId(bill.id);
    go("#bills/detail");
  };

  const resend = (bill: Bill) => {
    const tenant = tenantById.get(bill.tenantId);

    if (tenant === undefined || !tenant.lineLinked) {
      showToast(`ส่งไม่ได้ · ผู้เช่าห้อง ${bill.roomId} ยังไม่เชื่อม LINE กับหอ`);
      return;
    }

    setPendingSendId(bill.id);
    showToast(`กำลังส่งบิลห้อง ${bill.roomId} ทาง LINE`);

    window.setTimeout(() => {
      const stamp = nowLabel();
      setBills((prev) => prev.map((item) => (item.id === bill.id ? { ...item, lineSentAt: stamp } : item)));
      setPendingSendId(null);
      showToast(`ส่งบิลห้อง ${bill.roomId} ทาง LINE แล้ว`);
    }, 900);
  };

  const confirmMarkPaid = (bill: Bill, method: "โอน" | "เงินสด", date: string) => {
    setBills((prev) => prev.map((item) => (item.id === bill.id ? { ...item, status: "paid" } : item)));
    setPayments((prev) => ({
      ...prev,
      [bill.id]: [...(prev[bill.id] ?? []), { method, when: `${date} · ปิดบิลด้วยมือ`, note: "ปิดบิลด้วยมือโดยเจ้าของ", hasSlip: false }],
    }));
    setPayTarget(null);

    const connected = tenantById.get(bill.tenantId)?.lineLinked === true;
    showToast(
      connected
        ? `ปิดบิลห้อง ${bill.roomId} แล้ว และส่งข้อความยืนยันทาง LINE`
        : `ปิดบิลห้อง ${bill.roomId} แล้ว ผู้เช่ายังไม่เชื่อม LINE จึงยังไม่ส่งข้อความยืนยัน`,
    );
  };

  const confirmDelete = (bill: Bill) => {
    setBills((prev) => prev.filter((item) => item.id !== bill.id));
    setDeleteTarget(null);

    if (selectedId === bill.id) {
      setSelectedId(null);
      go("#bills");
    }

    showToast(`ลบบิลห้อง ${bill.roomId} แล้ว`);
  };

  const saveEdit = (updated: Bill) => {
    setBills((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    setEditTarget(null);
    showToast(`บันทึกการแก้ไขบิลห้อง ${updated.roomId} แล้ว`);
  };

  const mergeCreated = (created: Bill[]) => {
    const ids = new Set(created.map((bill) => bill.id));
    setBills((prev) => [...prev.filter((bill) => !ids.has(bill.id)), ...created]);
    showToast(`สร้างบิล ${created.length} รายการแล้ว`);
  };

  const markSent = (billIds: string[]) => {
    const ids = new Set(billIds);
    setBills((prev) => prev.map((bill) => (ids.has(bill.id) ? { ...bill, lineSentAt: nowLabel() } : bill)));
  };

  if (view === "create") {
    return (
      <div>
        <CreateWizard onCreated={mergeCreated} onSent={markSent} onFinish={() => go("#bills")} showToast={showToast} />
        <Toast message={toast ?? ""} open={toast !== null} />
      </div>
    );
  }

  const detailBill =
    bills.find((bill) => bill.id === selectedId) ??
    bills.find((bill) => bill.id === "A103-2569-09") ??
    bills.find((bill) => bill.status === "unpaid") ??
    bills[0];

  return (
    <div>
      {view === "detail" && detailBill !== undefined ? (
        <BillDetail
          bill={detailBill}
          history={payments[detailBill.id] ?? []}
          pendingSend={pendingSendId === detailBill.id}
          onBack={() => {
            setSelectedId(null);
            go("#bills");
          }}
          onResend={resend}
          onEdit={setEditTarget}
          onMarkPaid={setPayTarget}
          onDelete={setDeleteTarget}
        />
      ) : (
        <BillList
          bills={bills}
          pendingSendId={pendingSendId}
          onOpen={openDetail}
          onResend={resend}
          onEdit={setEditTarget}
          onMarkPaid={setPayTarget}
          onDelete={setDeleteTarget}
          onCreate={() => go("#bills/create")}
        />
      )}

      <EditBillDialog bill={editTarget} onClose={() => setEditTarget(null)} onSave={saveEdit} />
      <MarkPaidDialog bill={payTarget} today={todayIso()} onClose={() => setPayTarget(null)} onConfirm={confirmMarkPaid} />
      <DeleteBillDialog bill={deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={confirmDelete} />

      <Toast message={toast ?? ""} open={toast !== null} />
    </div>
  );
}
