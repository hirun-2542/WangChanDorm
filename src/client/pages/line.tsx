import { useState, type KeyboardEvent } from "react";
import { Badge, Card, CardHeader, PageHeader } from "../ui";
import { dorm, lineEvents } from "../mock-data";

function isArrowKey(key: string): boolean {
  return key === "ArrowRight" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowUp";
}

export function LinePage() {
  const [activeId, setActiveId] = useState<string>(lineEvents[0]?.id ?? "");
  const active = lineEvents.find((item) => item.id === activeId) ?? lineEvents[0];

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!isArrowKey(event.key)) {
      return;
    }

    event.preventDefault();
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (index + step + lineEvents.length) % lineEvents.length;
    const nextEvent = lineEvents[nextIndex];

    if (nextEvent !== undefined) {
      setActiveId(nextEvent.id);
      document.getElementById(`line-tab-${nextEvent.id}`)?.focus();
    }
  };

  return (
    <div>
      <PageHeader
        title="ข้อความ LINE"
        supporting={`${lineEvents.length} เหตุการณ์ข้อความที่ระบบส่งอัตโนมัติ · ตัวอย่างข้อความพร้อมตัวแปร`}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="min-w-0 lg:self-start">
          <CardHeader title="เหตุการณ์ข้อความ" description="เลือกเพื่อดูข้อความที่ส่งในแต่ละเหตุการณ์" />
          <div
            role="tablist"
            aria-label="เหตุการณ์ข้อความ LINE"
            className="flex gap-2 overflow-x-auto pb-1 pr-6 [mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent)] lg:flex-col lg:overflow-visible lg:pb-0 lg:pr-0 lg:[mask-image:none]"
          >
            {lineEvents.map((event, index) => {
              const selected = event.id === activeId;

              return (
                <button
                  key={event.id}
                  id={`line-tab-${event.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="line-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => {
                    setActiveId(event.id);
                  }}
                  onKeyDown={(keyEvent) => {
                    onTabKeyDown(keyEvent, index);
                  }}
                  className={`min-h-11 shrink-0 rounded-lg border px-3 py-2 text-left transition-colors lg:w-full ${
                    selected ? "border-pebble bg-paper-mist" : "border-ash hover:bg-paper-mist"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-charcoal">{event.label}</span>
                    <span className="chip">{event.audience}</span>
                  </span>
                  <span className="mt-0.5 hidden text-xs text-steel lg:block">{event.description}</span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card>
          {active === undefined ? null : (
            <div role="tabpanel" id="line-panel" aria-labelledby={`line-tab-${active.id}`} tabIndex={0}>
              <CardHeader
                title={active.label}
                description={active.description}
                actions={<Badge tone="neutral">ตัวอย่าง</Badge>}
              />

              <div className="rounded-2xl bg-paper-mist p-4">
                <div className="mx-auto max-w-[520px]">
                  <div className="rounded-2xl border border-ash bg-canvas-white p-4">
                    <p className="text-xs text-fog">{dorm.name} · ข้อความอัตโนมัติ</p>
                    <p className="mt-1.5 text-sm text-charcoal">{active.headline}</p>

                    {active.rows.length > 0 && (
                      <dl className="mt-3 grid gap-1.5 border-t border-ash pt-3 text-sm">
                        {active.rows.map((row) => {
                          const total = row.label === "รวม";

                          return (
                            <div key={row.label} className="flex items-center justify-between gap-3">
                              <dt className={total ? "font-medium text-charcoal" : "text-steel"}>{row.label}</dt>
                              <dd className={`num ${total ? "font-medium text-charcoal" : "text-charcoal"}`}>{row.value}</dd>
                            </div>
                          );
                        })}
                      </dl>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-steel">
                    ส่งถึง{active.audience === "เจ้าของ" ? "เจ้าของหอ" : "ผู้เช่า"} · ตัวอย่างข้อความ
                  </p>
                </div>
              </div>

              <div className="mt-3 border-t border-ash pt-3">
                <p className="text-xs text-fog">ตัวแปรที่ใช้ในข้อความ</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {active.variables.map((variable) => (
                    <span key={variable} className="chip">
                      {variable}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
