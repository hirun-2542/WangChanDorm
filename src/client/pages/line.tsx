import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import {
  ApiError,
  fetchLineMessages,
  type LineMessageKind,
  type LineMessageSource,
} from "../api";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Skeleton,
} from "../ui";
import { periodLabel } from "./bills-shared";

function isArrowKey(key: string): boolean {
  return (
    key === "ArrowRight" ||
    key === "ArrowDown" ||
    key === "ArrowLeft" ||
    key === "ArrowUp"
  );
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
  size: string | null;
}

interface PreviewHeader {
  background: string | null;
  lines: HeaderLine[];
}

type PreviewItem =
  | {
      kind: "row";
      label: string;
      value: string;
      bold: boolean;
      size: string | null;
      color: string | null;
    }
  | { kind: "note"; text: string; size: string | null; color: string | null }
  | { kind: "separator" }
  | { kind: "image"; url: string; size: string | null }
  | {
      kind: "button";
      label: string;
      uri: string;
      actionType: string;
      clipboardText: string;
      color: string;
      style: string;
    };

/** ขนาดตัวอักษรของ Flex — LINE กำหนดเป็นชื่อ ไม่ใช่ px */
const textSizes: Record<string, number> = {
  xxs: 11,
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
  xxl: 24,
  "3xl": 30,
  "4xl": 36,
  "5xl": 40,
};

const imageSizes: Record<string, number> = {
  xxs: 40,
  xs: 60,
  sm: 80,
  md: 100,
  lg: 120,
  xl: 140,
  xxl: 180,
  "3xl": 240,
  "4xl": 300,
  "5xl": 360,
};

function sizeStyle(
  sizes: Record<string, number>,
  size: string | null,
): { fontSize: number } | undefined {
  if (size === null) {
    return undefined;
  }

  const px = sizes[size];

  return px === undefined ? undefined : { fontSize: px };
}

function colorOf(node: FlexRecord): string | null {
  const value = node.color;

  return typeof value === "string" ? value : null;
}

function readHeader(node: FlexRecord | null): PreviewHeader {
  if (node === null) {
    return { background: null, lines: [] };
  }

  const backgroundValue = node.backgroundColor;
  const background =
    typeof backgroundValue === "string" ? backgroundValue : null;
  const lines: HeaderLine[] = [];

  for (const child of asArray(node.contents)) {
    if (isRecord(child) && child.type === "text") {
      const text = stringField(child, "text");

      if (text !== "") {
        lines.push({
          text,
          color: colorOf(child),
          size: stringField(child, "size") || null,
        });
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

    switch (type) {
      case "separator":
        items.push({ kind: "separator" });
        break;

      case "text": {
        const text = stringField(raw, "text");

        if (text !== "") {
          items.push({
            kind: "note",
            text,
            size: stringField(raw, "size") || null,
            color: colorOf(raw),
          });
        }

        break;
      }

      case "image":
        items.push({
          kind: "image",
          url: stringField(raw, "url"),
          size: stringField(raw, "size") || null,
        });
        break;

      case "button": {
        const action = isRecord(raw.action) ? raw.action : null;

        items.push({
          kind: "button",
          label: action === null ? "" : stringField(action, "label"),
          uri: action === null ? "" : stringField(action, "uri"),
          actionType: action === null ? "" : stringField(action, "type"),
          clipboardText:
            action === null ? "" : stringField(action, "clipboardText"),
          color: stringField(raw, "color"),
          style: stringField(raw, "style"),
        });
        break;
      }

      case "box": {
        if (raw.layout === "horizontal") {
          const children = asArray(raw.contents);
          const texts = children.filter(
            (child): child is FlexRecord =>
              isRecord(child) && child.type === "text",
          );
          const label = texts[0];
          const value = texts[1];

          if (
            label !== undefined &&
            value !== undefined &&
            children.every((child) => isRecord(child) && child.type === "text")
          ) {
            items.push({
              kind: "row",
              label: stringField(label, "text"),
              value: stringField(value, "text"),
              bold: value.weight === "bold",
              size: stringField(value, "size") || null,
              color: colorOf(value),
            });
            break;
          }

          // กล่องแนวนอนที่มีอย่างอื่นปน (เช่น ปุ่มคัดลอก) — ไล่เก็บทีละลูกตามลำดับ
          for (const child of children) {
            if (!isRecord(child)) {
              continue;
            }

            if (child.type === "text") {
              const text = stringField(child, "text");

              if (text !== "") {
                items.push({
                  kind: "note",
                  text,
                  size: stringField(child, "size") || null,
                  color: colorOf(child),
                });
              }

              continue;
            }

            collectItems([child], items);
          }

          break;
        }

        collectItems(raw.contents, items);
        break;
      }

      default:
        items.push({
          kind: "note",
          text: `ไม่รองรับโหนด ${typeof type === "string" ? type : "ไม่ทราบชนิด"}`,
          size: null,
          color: null,
        });
        break;
    }
  }
}

function PreviewItemView({ item }: { item: PreviewItem }) {
  switch (item.kind) {
    case "separator":
      return <div className="my-0.5 border-t border-ash" />;

    case "note":
      return (
        <p
          className="text-xs text-fog"
          style={{
            ...sizeStyle(textSizes, item.size),
            color: item.color ?? undefined,
          }}
        >
          {item.text}
        </p>
      );

    case "row":
      return (
        <div className="flex items-start justify-between gap-3 text-sm">
          <span className="text-steel">{item.label}</span>
          <span
            className={`num text-right ${item.bold ? "font-medium" : ""}`}
            style={{
              ...sizeStyle(textSizes, item.size),
              color: item.color ?? "#171717",
            }}
          >
            {item.value}
          </span>
        </div>
      );

    case "image": {
      const px = item.size === null ? undefined : imageSizes[item.size];

      return (
        <div className="grid place-items-center rounded-lg border border-ash p-2">
          {item.url === "" ? (
            <p className="py-4 text-center text-xs text-fog">
              รูปภาพไม่ระบุ URL
            </p>
          ) : (
            <img
              src={item.url}
              alt="รูปภาพที่แนบในการ์ด"
              loading="lazy"
              className="rounded-lg border border-ash bg-paper-mist object-contain"
              style={
                px === undefined
                  ? { height: 128, width: 128 }
                  : { height: px, width: px }
              }
            />
          )}
        </div>
      );
    }

    case "button": {
      const label = item.label === "" ? "ปุ่ม" : item.label;
      const href = item.uri === "" ? undefined : item.uri;

      if (item.actionType === "clipboard") {
        return (
          <button
            type="button"
            className="rounded-lg border border-pebble bg-canvas-white px-4 py-2 text-center text-sm font-medium text-charcoal"
            title={`คัดลอก ${item.clipboardText}`}
            onClick={() => {
              void navigator.clipboard.writeText(item.clipboardText);
            }}
          >
            {label}
          </button>
        );
      }

      if (item.style === "link") {
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-charcoal underline underline-offset-2"
          >
            {label}
          </a>
        );
      }

      if (item.style === "secondary") {
        return (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-pebble px-4 py-2 text-center text-sm font-medium text-charcoal"
          >
            {label}
          </a>
        );
      }

      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg px-4 py-2 text-center text-sm font-medium text-white"
          style={{
            backgroundColor: item.color === "" ? "#2563eb" : item.color,
          }}
        >
          {label}
        </a>
      );
    }
  }
}

function FlexPreview({ message }: { message: LineMessageKind["message"] }) {
  const bubble = isRecord(message.contents) ? message.contents : null;
  const headerNode =
    bubble === null ? null : isRecord(bubble.header) ? bubble.header : null;
  const header = readHeader(headerNode);
  const bodyItems: PreviewItem[] = [];
  const footerItems: PreviewItem[] = [];

  if (bubble !== null) {
    const body = isRecord(bubble.body) ? bubble.body : null;
    collectItems(body === null ? [] : body.contents, bodyItems);

    const footer = isRecord(bubble.footer) ? bubble.footer : null;
    collectItems(footer === null ? [] : footer.contents, footerItems);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-ash bg-canvas-white">
      {header.lines.length > 0 && (
        <div
          className="px-4 py-3"
          style={
            header.background === null
              ? undefined
              : { backgroundColor: header.background }
          }
        >
          {header.lines.map((line, index) => (
            <p
              key={`${line.text}-${index}`}
              className={index === 0 ? "font-medium" : "mt-0.5"}
              style={{
                ...sizeStyle(textSizes, line.size),
                color: line.color ?? undefined,
              }}
            >
              {line.text}
            </p>
          ))}
        </div>
      )}

      {bodyItems.length > 0 && (
        <div className="grid gap-1.5 px-4 py-3">
          {bodyItems.map((item, index) => (
            <PreviewItemView key={`body-${index}`} item={item} />
          ))}
        </div>
      )}

      {footerItems.length > 0 && (
        <div className="grid gap-1.5 border-t border-ash px-4 py-3">
          {footerItems.map((item, index) => (
            <PreviewItemView key={`footer-${index}`} item={item} />
          ))}
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
      setError(
        loadError instanceof ApiError
          ? loadError.message
          : "โหลดข้อความ LINE ไม่สำเร็จ",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = messages.find((item) => item.key === activeKey) ?? messages[0];

  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (!isArrowKey(event.key)) {
      return;
    }

    event.preventDefault();
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
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
            <CardHeader
              title="ข้อความที่บอทส่ง"
              description="เลือกเพื่อดูว่าใครได้รับ เมื่อไร และข้อความหน้าตาเป็นอย่างไร"
            />
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
                      selected
                        ? "border-pebble bg-paper-mist"
                        : "border-ash hover:bg-paper-mist"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium text-charcoal">
                        {item.title}
                      </span>
                      <span className="chip">
                        {item.audience === "owner" ? "เจ้าของ" : "ผู้เช่า"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            <div
              role="tabpanel"
              id="line-panel"
              aria-labelledby={`line-tab-${active.key}`}
              tabIndex={0}
            >
              <CardHeader
                title={active.title}
                description={active.trigger}
                actions={
                  <Badge
                    tone={active.audience === "owner" ? "review" : "neutral"}
                  >
                    {active.audience === "owner"
                      ? "ถึงเจ้าของหอ"
                      : "ถึงผู้เช่า"}
                  </Badge>
                }
              />

              <div className="rounded-2xl bg-paper-mist p-4">
                <div className="mx-auto max-w-[520px]">
                  <div className="mb-2 flex items-start gap-2 rounded-xl border border-ash bg-canvas-white px-3 py-2">
                    <span
                      className="ms mt-0.5 text-[16px] text-steel"
                      aria-hidden="true"
                    >
                      notifications
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] text-fog">
                        ข้อความแจ้งเตือนที่ผู้เช่าเห็นก่อนเปิด
                      </p>
                      <p className="text-xs text-charcoal">
                        {active.message.altText}
                      </p>
                    </div>
                  </div>
                  <FlexPreview message={active.message} />
                </div>
                <p className="mt-2 text-center text-[11px] text-steel">
                  ข้อความการ์ด Flex ที่บอทส่งจริง · ส่งถึง
                  {active.audience === "owner" ? "เจ้าของหอ" : "ผู้เช่า"}
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
