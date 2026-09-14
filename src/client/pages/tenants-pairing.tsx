import { useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Select } from "../ui";
import type { Tenant } from "../mock-data";

export interface PendingLineUser {
  id: string;
  displayName: string;
  lastMessage: string;
  time: string;
}

export interface PairingResult {
  pendingId: string;
  tenantId: string;
  tenantName: string;
  roomId: string;
}

export function seedPendingUsers(): PendingLineUser[] {
  return [
    {
      id: "lp-1",
      displayName: "พลอย ชุติมณฑน์",
      lastMessage: "สวัสดีค่ะ ฝากเชื่อมต่อกับห้องของหอด้วยนะคะ",
      time: "วันนี้ · 09:14",
    },
  ];
}

export interface PairingSurfaceProps {
  pending: PendingLineUser[];
  tenants: Tenant[];
  onPaired: (result: PairingResult) => void;
  onBack: () => void;
}

export function PairingSurface({ pending, tenants, onPaired, onBack }: PairingSurfaceProps) {
  const [selectedPendingId, setSelectedPendingId] = useState<string>(() => pending[0]?.id ?? "");
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [success, setSuccess] = useState<PairingResult | null>(null);

  const activePending = pending.find((user) => user.id === selectedPendingId) ?? pending[0] ?? null;
  const candidates = tenants.filter((tenant) => tenant.status === "current" && !tenant.lineLinked);

  const pair = () => {
    const tenant = candidates.find((item) => item.id === selectedTenantId);

    if (activePending === null || tenant === undefined) {
      return;
    }

    const result: PairingResult = {
      pendingId: activePending.id,
      tenantId: tenant.id,
      tenantName: tenant.name,
      roomId: tenant.roomId,
    };

    onPaired(result);
    setSuccess(result);
    setSelectedTenantId("");
  };

  return (
    <div>
      <PageHeader
        title="จัดการการเชื่อม LINE"
        supporting={
          pending.length === 0
            ? "ไม่มีผู้ใช้ LINE รอจับคู่"
            : `${pending.length} คนที่แอด LINE แล้วแต่ยังจับคู่ไม่ได้`
        }
        actions={
          <Button variant="ghost" icon="arrow_back" onClick={onBack}>
            กลับไปรายชื่อผู้เช่า
          </Button>
        }
      />

      {success === null ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Card className="lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto">
            <CardHeader title="ผู้ใช้ LINE รอจับคู่" description={`แสดง ${pending.length} คน`} />
            {pending.length === 0 ? (
              <p className="py-6 text-center text-sm text-fog">ไม่มีผู้ใช้ LINE รอจับคู่ในขณะนี้</p>
            ) : (
              <ul className="grid gap-2">
                {pending.map((user) => {
                  const active = activePending !== null && user.id === activePending.id;

                  return (
                    <li key={user.id}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          setSelectedPendingId(user.id);
                        }}
                        className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                          active ? "border-pebble bg-paper-mist" : "border-ash hover:bg-paper-mist"
                        }`}
                      >
                        <span
                          className="ms grid h-10 w-10 shrink-0 place-items-center rounded-full bg-paper-mist text-[20px] text-slate"
                          aria-hidden="true"
                        >
                          person
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium text-charcoal">{user.displayName}</span>
                            <span className="shrink-0 text-[11px] text-fog">{user.time}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-fog">{user.lastMessage}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            {activePending === null ? (
              <EmptyState
                icon="link"
                title="ยังไม่มีผู้ใช้ LINE รอจับคู่"
                description="เมื่อผู้เช่าแอดบอทและพิมพ์เลขห้อง ระบบจะแสดงรายชื่อไว้ที่นี่เพื่อจับคู่กับผู้เช่า"
                action={
                  <Button variant="secondary" icon="arrow_back" onClick={onBack}>
                    กลับไปรายชื่อผู้เช่า
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-4">
                <CardHeader
                  title="จับคู่กับผู้เช่า"
                  description="เลือกผู้เช่าที่ตรงกับผู้ใช้ LINE รายนี้"
                  actions={<Badge tone="neutral">รอจับคู่</Badge>}
                />

                <div className="panel-muted">
                  <p className="text-sm text-charcoal">{activePending.displayName}</p>
                  <p className="mt-1 text-sm text-steel">{activePending.lastMessage}</p>
                  <p className="mt-1 text-xs text-fog">ข้อความล่าสุด · {activePending.time}</p>
                </div>

                {candidates.length === 0 ? (
                  <p className="text-sm text-fog">ผู้เช่าทุกคนเชื่อม LINE แล้ว จึงไม่มีรายการให้จับคู่เพิ่ม</p>
                ) : (
                  <>
                    <Select
                      label="เลือกผู้เช่า"
                      value={selectedTenantId}
                      onChange={setSelectedTenantId}
                      options={[
                        { value: "", label: "ยังไม่ได้เลือก" },
                        ...candidates.map((tenant) => ({
                          value: tenant.id,
                          label: `${tenant.name} · ห้อง ${tenant.roomId}`,
                        })),
                      ]}
                      helper="จับคู่แล้วบิลและข้อความยืนยันจะส่งถึงผู้ใช้ LINE รายนี้"
                    />

                    <div className="flex justify-end">
                      <Button variant="primary" icon="link" disabled={selectedTenantId === ""} onClick={pair}>
                        จับคู่ LINE
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </Card>
        </div>
      ) : (
        <Card>
          <EmptyState
            icon="link"
            title={`เชื่อม LINE กับ คุณ${success.tenantName} ห้อง ${success.roomId} สำเร็จ`}
            description="ผู้เช่าจะได้รับข้อความยืนยันใน LINE และบิลของห้องนี้จะส่งถึงผู้ใช้ LINE รายนี้ได้แล้ว"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {pending.length > 0 && (
                  <Button
                    variant="secondary"
                    icon="link"
                    onClick={() => {
                      setSuccess(null);
                    }}
                  >
                    จับคู่รายการถัดไป
                  </Button>
                )}
                <Button variant="primary" icon="arrow_back" onClick={onBack}>
                  กลับไปรายชื่อผู้เช่า
                </Button>
              </div>
            }
          />
        </Card>
      )}
    </div>
  );
}
