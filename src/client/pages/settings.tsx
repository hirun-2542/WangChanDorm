import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ApiError,
  fetchSettings,
  regenerateOwnerCode,
  updateSettings,
  type PromptpayType,
  type Settings,
} from "../api";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Field, PageHeader, Skeleton, Toast } from "../ui";
import { ChoiceRow, numericValue } from "./dorm-shared";

const sectionList = [
  { id: "settings-dorm", label: "ข้อมูลหอ" },
  { id: "settings-rates", label: "ค่าน้ำ/ค่าไฟ" },
  { id: "settings-promptpay", label: "พร้อมเพย์" },
  { id: "settings-line", label: "LINE เจ้าของ" },
  { id: "settings-integrations", label: "การเชื่อมต่อ" },
] as const;

interface SectionProps {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}

function Section({ id, title, description, children }: SectionProps) {
  return (
    <div id={id} className="scroll-mt-20">
      <Card>
        <CardHeader title={title} description={description} />
        {children}
      </Card>
    </div>
  );
}

function IntegrationRow({ name, description, configured }: { name: string; description: string; configured: boolean }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ash px-3 py-2.5">
      <div className="min-w-0">
        <span className="block text-sm text-charcoal">{name}</span>
        <span className="block text-xs text-fog">{description}</span>
      </div>
      <Badge tone={configured ? "paid" : "neutral"} icon={configured ? "check_circle" : "link_off"}>
        {configured ? "ตั้งค่าแล้ว" : "ยังไม่ตั้งค่า"}
      </Badge>
    </li>
  );
}

function QrPreview() {
  const path = useMemo(() => {
    const size = 21;
    let data = "";

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const finderAt = (originX: number, originY: number) => {
          const localX = x - originX;
          const localY = y - originY;
          const edge = localX === 0 || localY === 0 || localX === 6 || localY === 6;
          const core = localX >= 2 && localX <= 4 && localY >= 2 && localY <= 4;
          return edge || core;
        };

        let on: boolean;

        if (x < 7 && y < 7) {
          on = finderAt(0, 0);
        } else if (x >= size - 7 && y < 7) {
          on = finderAt(size - 7, 0);
        } else if (x < 7 && y >= size - 7) {
          on = finderAt(0, size - 7);
        } else {
          on = (x * 3 + y * 5 + ((x * y) % 7)) % 11 < 5;
        }

        if (on) {
          data += `M${x} ${y}h1v1h-1z`;
        }
      }
    }

    return data;
  }, []);

  return (
    <div className="rounded-xl border border-ash p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-charcoal">ภาพตัวอย่าง QR พร้อมเพย์</span>
        <Badge tone="neutral">ตัวอย่าง — ไม่ใช้เงินจริง</Badge>
      </div>
      <div className="mx-auto mt-3 w-40 text-charcoal" aria-hidden="true">
        <svg viewBox="-2 -2 25 25" width="100%" role="presentation">
          <path d={path} fill="currentColor" shapeRendering="crispEdges" />
        </svg>
      </div>
      <p className="mt-2 text-center text-xs text-fog">ภาพนี้เป็นตัวอย่างสำหรับดูตำแหน่งเท่านั้น ไม่ใช่รหัสที่สแกนจ่ายได้จริง</p>
    </div>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ message: string; field?: string } | null>(null);
  const [dormName, setDormName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [waterRate, setWaterRate] = useState("");
  const [electricRate, setElectricRate] = useState("");
  const [payType, setPayType] = useState<PromptpayType>("phone");
  const [payId, setPayId] = useState("");
  const [payName, setPayName] = useState("");
  const [code, setCode] = useState("");
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [activeSection, setActiveSection] = useState<string>(sectionList[0].id);
  const [toast, setToast] = useState<string | null>(null);

  const applySettings = useCallback((data: Settings) => {
    setSettings(data);
    setDormName(data.dormName);
    setOwnerName(data.ownerName);
    setWaterRate(String(data.defaultWaterRate));
    setElectricRate(String(data.defaultElectricRate));
    setPayType(data.promptpayType === "citizen-id" ? "citizen-id" : "phone");
    setPayId(data.promptpayId);
    setPayName(data.promptpayName);
    setCode(data.ownerLinkCode);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const data = await fetchSettings();
      applySettings(data);
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : "โหลดการตั้งค่าไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [applySettings]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const ready = !loading && loadError === null && settings !== null;

  useEffect(() => {
    if (!ready) {
      return;
    }

    const nodes = sectionList
      .map((item) => document.getElementById(item.id))
      .filter((node): node is HTMLElement => node !== null);

    if (nodes.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0];

        if (first !== undefined) {
          setActiveSection(first.target.id);
        }
      },
      { rootMargin: "-96px 0px -55% 0px", threshold: 0 },
    );

    nodes.forEach((node) => {
      observer.observe(node);
    });

    return () => {
      observer.disconnect();
    };
  }, [ready]);

  const waterValue = numericValue(waterRate);
  const electricValue = numericValue(electricRate);
  const canSave =
    dormName.trim() !== "" &&
    payId.trim() !== "" &&
    waterValue !== null &&
    waterValue > 0 &&
    electricValue !== null &&
    electricValue > 0 &&
    !saving;

  const fieldError = (name: string): string | undefined =>
    saveError !== null && saveError.field === name ? saveError.message : undefined;

  const goTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSection(id);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);

    try {
      const updated = await updateSettings({
        dormName: dormName.trim(),
        ownerName: ownerName.trim(),
        defaultWaterRate: waterValue ?? 0,
        defaultElectricRate: electricValue ?? 0,
        promptpayType: payType,
        promptpayId: payId.trim(),
        promptpayName: payName.trim(),
      });
      applySettings(updated);
      setToast("บันทึกการตั้งค่าเรียบร้อย");
    } catch (error) {
      if (error instanceof ApiError && error.field !== undefined) {
        setSaveError({ message: error.message, field: error.field });
      } else {
        setSaveError(null);
        setToast(error instanceof ApiError ? error.message : "บันทึกการตั้งค่าไม่สำเร็จ");
      }
    } finally {
      setSaving(false);
    }
  };

  const regenCode = async () => {
    try {
      const next = await regenerateOwnerCode();
      setCode(next);
      setSettings((current) => (current === null ? current : { ...current, ownerLinkCode: next }));
      setConfirmRegen(false);
      setToast(`ออกรหัสเชื่อมต่อใหม่ ${next} แล้ว`);
    } catch (error) {
      setConfirmRegen(false);
      setToast(error instanceof ApiError ? error.message : "ออกรหัสเชื่อมต่อใหม่ไม่สำเร็จ");
    }
  };

  const ownerConnected = settings?.ownerLineConnected ?? false;

  return (
    <div className="pb-24">
      <PageHeader title="ตั้งค่า" supporting="แก้ค่าตั้งต้นของหอโดยไม่กระทบบิลที่สร้างไปแล้ว" />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="หัวข้อตั้งค่า" className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
            {sectionList.map((item) => {
              const active = activeSection === item.id;

              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => {
                      goTo(item.id);
                    }}
                    className={`flex min-h-11 w-auto items-center whitespace-nowrap rounded-lg px-3 text-left text-sm transition-colors lg:w-full ${
                      active ? "bg-status-unpaid-bg font-medium text-deep-sapphire" : "text-steel hover:bg-paper-mist"
                    }`}
                  >
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="grid gap-4">
          {loadError !== null ? (
            <Card>
              <EmptyState
                icon="cloud_off"
                title="โหลดการตั้งค่าไม่สำเร็จ"
                description={loadError}
                action={
                  <Button
                    variant="secondary"
                    icon="refresh"
                    onClick={() => {
                      void load();
                    }}
                  >
                    ลองใหม่
                  </Button>
                }
              />
            </Card>
          ) : settings === null ? (
            <Card>
              <div className="grid gap-4" aria-busy="true">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-10 w-2/3" />
              </div>
            </Card>
          ) : (
            <>
              <Section id="settings-dorm" title="ข้อมูลหอ" description="แสดงบนใบแจ้งหนี้และข้อความที่ส่งถึงผู้เช่า">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="ชื่อหอ"
                    value={dormName}
                    onChange={setDormName}
                    error={fieldError("dormName") ?? (dormName.trim() === "" ? "กรอกชื่อหอ" : undefined)}
                  />
                  <Field
                    label="ชื่อเจ้าของ"
                    value={ownerName}
                    onChange={setOwnerName}
                    error={fieldError("ownerName")}
                  />
                </div>
              </Section>

              <Section id="settings-rates" title="ค่าน้ำ/ค่าไฟ" description="อัตราตั้งต้นที่ใช้กับห้องที่ยังไม่กำหนดอัตราเอง">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="ค่าน้ำตั้งต้น (บาท/หน่วย)"
                    value={waterRate}
                    onChange={setWaterRate}
                    inputMode="numeric"
                    helper={`ปัจจุบัน ${settings.defaultWaterRate} บาท/หน่วย`}
                    error={fieldError("defaultWaterRate") ?? (waterValue === null || waterValue <= 0 ? "กรอกอัตราที่มากกว่า 0" : undefined)}
                  />
                  <Field
                    label="ค่าไฟตั้งต้น (บาท/หน่วย)"
                    value={electricRate}
                    onChange={setElectricRate}
                    inputMode="numeric"
                    helper={`ปัจจุบัน ${settings.defaultElectricRate} บาท/หน่วย`}
                    error={fieldError("defaultElectricRate") ?? (electricValue === null || electricValue <= 0 ? "กรอกอัตราที่มากกว่า 0" : undefined)}
                  />
                </div>
                <div className="panel-muted mt-4">
                  <p className="text-sm text-charcoal">บิลที่สร้างไปแล้วจะไม่เปลี่ยนตามค่านี้</p>
                  <p className="mt-1 text-xs text-steel">
                    ทุกบิลจะเก็บอัตราน้ำไฟที่ใช้ตอนออกบิลไว้เป็นข้อมูลของบิลนั้น และใช้ค่าที่บันทึกไว้ตลอดไป
                  </p>
                </div>
              </Section>

              <Section id="settings-promptpay" title="พร้อมเพย์" description="ใช้สร้าง QR ให้ผู้เช่าสแกนจ่ายเมื่อออกบิล">
                <fieldset className="grid gap-2">
                  <legend className="field-label">ประเภทพร้อมเพย์</legend>
                  <ChoiceRow
                    name="promptpay-type"
                    checked={payType === "phone"}
                    title="เบอร์โทรศัพท์"
                    helper="ใช้เบอร์ที่ผูกพร้อมเพย์ไว้ เช่น 081-234-5678"
                    onSelect={() => {
                      setPayType("phone");
                    }}
                  />
                  <ChoiceRow
                    name="promptpay-type"
                    checked={payType === "citizen-id"}
                    title="เลขบัตรประชาชน / นิติบุคคล"
                    helper="ใช้เลข 13 หลักที่ลงทะเบียนพร้อมเพย์"
                    onSelect={() => {
                      setPayType("citizen-id");
                    }}
                  />
                </fieldset>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field
                    label="PromptPay ID"
                    value={payId}
                    onChange={setPayId}
                    helper={payType === "phone" ? "เบอร์โทรศัพท์ที่ผูกพร้อมเพย์" : "เลขบัตรประชาชนหรือเลขทะเบียนนิติบุคคล 13 หลัก"}
                    error={fieldError("promptpayId") ?? (payId.trim() === "" ? "กรอกพร้อมเพย์ไอดี" : undefined)}
                  />
                  <Field label="ชื่อบัญชี" value={payName} onChange={setPayName} error={fieldError("promptpayName")} />
                </div>

                <div className="mt-4">
                  <QrPreview />
                </div>
              </Section>

              <Section id="settings-line" title="LINE เจ้าของ" description="ใช้รับสลิปและแจ้งเตือนไปยัง LINE ของเจ้าของหอ">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ash px-3 py-2.5">
                  <div className="min-w-0">
                    <span className="block text-sm text-charcoal">สถานะการเชื่อมต่อ</span>
                    <span className="block text-xs text-fog">แจ้งเตือนสลิปรอตรวจและสรุปผลการส่งบิลจะส่งมาที่ LINE นี้</span>
                  </div>
                  <Badge tone={ownerConnected ? "paid" : "vacant"} icon={ownerConnected ? "check_circle" : "link_off"}>
                    {ownerConnected ? "เชื่อมแล้ว" : "ยังไม่เชื่อม"}
                  </Badge>
                </div>

                {!ownerConnected && (
                  <p className="mt-3 text-xs text-steel">พิมพ์รหัสด้านล่างในแชท LINE บอทเพื่อเชื่อมและรับการแจ้งเตือนจากระบบ</p>
                )}

                <div className="mt-4 rounded-lg border border-ash p-4">
                  <p className="text-xs text-fog">รหัสเชื่อมต่อ 6 หลัก</p>
                  <p className="num mt-1 text-2xl tracking-[0.3em] text-charcoal">{code}</p>
                  <p className="mt-1 text-xs text-steel">ให้เจ้าของหอพิมพ์รหัสนี้ในแชท LINE บอทเพื่อยืนยันตัวตน</p>
                  <Button
                    variant="secondary"
                    icon="refresh"
                    className="mt-3"
                    onClick={() => {
                      setConfirmRegen(true);
                    }}
                  >
                    ออกรหัสใหม่
                  </Button>
                </div>
              </Section>

              <Section id="settings-integrations" title="การเชื่อมต่อ" description="สถานะบริการที่หอใช้อยู่">
                <ul className="grid gap-3">
                  <IntegrationRow
                    name="LINE Messaging API"
                    description="ใช้ส่งบิลและข้อความอัตโนมัติให้ผู้เช่า"
                    configured={settings.integrations.lineConfigured}
                  />
                  <IntegrationRow
                    name="SlipOK"
                    description="ตรวจสลิปอัตโนมัติเมื่อผู้เช่าส่งสลิปเข้ามา"
                    configured={settings.integrations.slipOkConfigured}
                  />
                </ul>
                <p className="mt-3 text-xs text-fog">ระบบเก็บคีย์การเชื่อมต่อไว้ฝั่งเซิร์ฟเวอร์ จึงไม่แสดงคีย์ในหน้านี้</p>
              </Section>
            </>
          )}
        </div>
      </div>

      {ready && (
        <div className="fixed inset-x-0 bottom-[calc(3.5rem_+_env(safe-area-inset-bottom))] z-30 border-t border-ash bg-canvas-white px-4 py-3 md:inset-x-auto md:bottom-6 md:right-6 md:rounded-xl md:border md:px-3 md:py-2">
          <Button
            variant="primary"
            icon="save"
            className="w-full md:w-auto"
            disabled={!canSave}
            onClick={() => {
              void save();
            }}
          >
            บันทึกการตั้งค่า
          </Button>
        </div>
      )}

      <Dialog
        open={confirmRegen}
        onClose={() => {
          setConfirmRegen(false);
        }}
        title="ออกรหัสเชื่อมต่อใหม่"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmRegen(false);
              }}
            >
              ยกเลิก
            </Button>
            <Button
              variant="primary"
              icon="refresh"
              onClick={() => {
                void regenCode();
              }}
            >
              ออกรหัสใหม่
            </Button>
          </>
        }
      >
        <p className="text-sm text-steel">
          เมื่อยืนยันแล้ว รหัสเดิม {code} จะถูกยกเลิกทันที และใช้เชื่อมต่อไม่ได้อีก ต้องใช้รหัสใหม่เท่านั้น
        </p>
      </Dialog>

      <Toast message={toast ?? ""} open={toast !== null} />
    </div>
  );
}
