import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { ApiError, fetchLineMessages, type LineMessageKind, type LineMessageSource } from "../api";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Skeleton } from "../ui";
import { periodLabel } from "./bills-shared";

function isArrowKey(key: string): boolean {
  return key === "ArrowRight" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowUp";
}

type FlexRecord = Record<string, unknown>;

function isRecord(value: unknown): value is FlexRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

function stringField(node: FlexRecord, key: string): string {
  const value = node[key];
  return typeof value === "string" ? value : "";
}

interface HeaderLine {
  text: string;
  color: string | null;
}

interface PreviewHeader {
  background: string | null;
  lines: HeaderLine[];
}

type PreviewItem =
  | { kind: "row"; label: string; value: string; bold: boolean }
  | { kind: "note"; text: string }
  | { kind: "separator" };

function readHeader(node: FlexRecord | null): PreviewHeader {
  if (node === null) {
    return { background: null, lines: [] };
  }

  const backgroundValue = node.backgroundColor;
  const background = typeof backgroundValue === "string" ? backgroundValue : null;
  const lines: HeaderLine[] = [];

  for (const child of asArray(node.contents)) {
    if (isRecord(child) && child.type === "text") {
      const text = stringField(child, "text");

      if (text !== "") {
        const colorValue = child.color;
        lines.push({ text, color: typeof colorValue === "string" ? colorValue : null });
      }
    }
  }

  return { background, lines };
}

function collectItems(nodes: unknown, items: PreviewItem[]): void {
  for (const raw of asArray(nodes)) {
    if (!isRecord(raw)) {
      continue;
    }

    const type = raw.type;

    if (type === "separator") {
      items.push({ kind: "separator" });
      continue;
    }

    if (type === "text") {
      const text = stringField(raw, "text");

      if (text !== "") {
        items.push({ kind: "note", text });
      }

      continue;
    }

    if (type !== "box") {
      continue;
    }

    if (raw.layout === "horizontal") {
      const texts = asArray(raw.contents).filter((child): child is FlexRecord => isRecord(child) && child.type === "text");
      const label = texts[0];
      const value = texts[1];

      if (label !== undefined && value !== undefined) {
        items.push({ kind: "row", label: stringField(label, "text"), value: stringField(value, "text"), bold: value.weight === "bold" });
        continue;
      }

      for (const node of texts) {
        const text = stringField(node, "text");

        if (text !== "") {
          items.push({ kind: "note", text });
        }
      }

      continue;
    }

    collectItems(raw.contents, items);
  }
}

function FlexPreview({ message }: { message: LineMessageKind["message"] }) {
  const bubble = isRecord(message.contents) ? message.contents : null;
  const headerNode = bubble === null ? null : isRecord(bubble.header) ? bubble.header : null;
  const header = readHeader(headerNode);
  const items: PreviewItem[] = [];

  if (bubble !== null) {
    const body = isRecord(bubble.body) ? bubble.body : null;
    collectItems(body === null ? [] : body.contents, items);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-ash bg-canvas-white">
      {header.lines.length > 0 && (
        <div className="px-4 py-3" style={header.background === null ? undefined : { backgroundColor: header.background }}>
          {header.lines.map((line, index) => (
            <p
              key={`${line.text}-${index}`}
              className={index === 0 ? "text-sm font-medium" : "mt-0.5 text-xs"}
              style={line.color === null ? undefined : { color: line.color }}
            >
              {line.text}
            </p>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="grid gap-1.5 px-4 py-3">
          {items.map((item, index) =>
            item.kind === "separator" ? (
              <div key={`separator-${index}`} className="my-0.5 border-t border-ash" />
            ) : item.kind === "note" ? (
              <p key={`note-${index}`} className="text-xs text-fog">
                {item.text}
              </p>
            ) : (
              <div key={`row-${index}`} className="flex items-start justify-between gap-3 text-sm">
                <span className="text-steel">{item.label}</span>
                <span className={`num text-right text-charcoal ${item.bold ? "font-medium" : ""}`}>{item.value}</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function LinePage() {
  const [messages, setMessages] = useState<LineMessageKind[]>([]);
  const [source, setSource] = useState<LineMessageSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchLineMessages();
      setMessages(result.messages);
      setSource(result.source);
    } catch (loadError) {
      setMessages([]);
      setSource(null);
      setError(loadError instanceof ApiError ? loadError.message : "โหลดข้อความ LINE ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = messages.find((item) => item.key === activeKey) ?? messages[0];

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!isArrowKey(event.key)) {
      return;
    }

    event.preventDefault();
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (index + step + messages.length) % messages.length;
    const next = messages[nextIndex];

    if (next !== undefined) {
      setActiveKey(next.key);
      document.getElementById(`line-tab-${next.key}`)?.focus();
    }
  };

  const supporting = loading
    ? "กำลังโหลดข้อความ"
    : error !== null
      ? "โหลดข้อความไม่สำเร็จ"
      : source === null
        ? `${messages.length} ข้อความที่บอทส่งเป็นข้อความการ์ด Flex`
        : `${messages.length} ข้อความที่บอทส่งเป็นข้อความการ์ด Flex · ตัวอย่างจากบิลห้อง ${source.roomNumber} เดือน ${periodLabel(source.period)}`;

  return (
    <div>
      <PageHeader title="ข้อความ LINE" supporting={supporting} />

      {loading ? (
        <Card>
          <div className="grid gap-3" aria-busy="true">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-2/3" />
          </div>
        </Card>
      ) : error !== null ? (
        <Card>
          <EmptyState
            icon="cloud_off"
            title="โหลดข้อความ LINE ไม่สำเร็จ"
            description={error}
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
      ) : active === undefined ? (
        <Card>
          <EmptyState
            icon="chat_bubble"
            title="ยังไม่มีข้อความที่บอทส่ง"
            description="ข้อความการ์ด Flex ของบอทจะแสดงที่นี่เมื่อระบบเริ่มส่งให้ผู้เช่าหรือเจ้าของ"
          />
        </Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Card className="min-w-0 lg:self-start">
            <CardHeader title="ข้อความที่บอทส่ง" description="เลือกเพื่อดูว่าใครได้รับ เมื่อไร และข้อความหน้าตาเป็นอย่างไร" />
            <div
              role="tablist"
              aria-label="ข้อความ LINE ที่บอทส่ง"
              className="flex gap-2 overflow-x-auto pb-1 pr-6 [mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent)] lg:flex-col lg:overflow-visible lg:pb-0 lg:pr-0 lg:[mask-image:none]"
            >
              {messages.map((item, index) => {
                const selected = item.key === active.key;

                return (
                  <button
                    key={item.key}
                    id={`line-tab-${item.key}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls="line-panel"
                    tabIndex={selected ? 0 : -1}
                    onClick={() => {
                      setActiveKey(item.key);
                    }}
                    onKeyDown={(keyEvent) => {
                      onTabKeyDown(keyEvent, index);
                    }}
                    className={`min-h-11 shrink-0 rounded-lg border px-3 py-2 text-left transition-colors lg:w-full ${
                      selected ? "border-pebble bg-paper-mist" : "border-ash hover:bg-paper-mist"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium text-charcoal">{item.title}</span>
                      <span className="chip">{item.audience === "owner" ? "เจ้าของ" : "ผู้เช่า"}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            <div role="tabpanel" id="line-panel" aria-labelledby={`line-tab-${active.key}`} tabIndex={0}>
              <CardHeader
                title={active.title}
                description={active.trigger}
                actions={
                  <Badge tone={active.audience === "owner" ? "review" : "neutral"}>
                    {active.audience === "owner" ? "ถึงเจ้าของหอ" : "ถึงผู้เช่า"}
                  </Badge>
                }
              />

              <div className="rounded-2xl bg-paper-mist p-4">
                <div className="mx-auto max-w-[520px]">
                  <FlexPreview message={active.message} />
                </div>
                <p className="mt-2 text-center text-[11px] text-steel">
                  ข้อความการ์ด Flex ที่บอทส่งจริง · ส่งถึง{active.audience === "owner" ? "เจ้าของหอ" : "ผู้เช่า"}
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
