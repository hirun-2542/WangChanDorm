import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const DEV_VARS_PATH = fileURLToPath(new URL(".dev.vars", ROOT));
const IMAGE_PATH = fileURLToPath(new URL("assets/rich-menu/rich-menu.png", ROOT));

const MESSAGING_API = "https://api.line.me/v2/bot";
const DATA_API = "https://api-data.line.me/v2/bot";

const MENU_NAME = "เมนูหอพักวังจันทร์";
const CHAT_BAR_TEXT = "เมนู";
const SIZE = { width: 2500, height: 1686 };

function parseDevVars(text) {
  const vars = {};

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();

    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const eq = line.indexOf("=");

    if (eq === -1) {
      continue;
    }

    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();

    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];

      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }

    vars[key] = value;
  }

  return vars;
}

function loadLocalVars() {
  try {
    return parseDevVars(readFileSync(DEV_VARS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function resolveValue(local, envName) {
  const fromEnv = process.env[envName];

  if (typeof fromEnv === "string" && fromEnv.trim() !== "") {
    return fromEnv.trim();
  }

  const fromFile = local[envName];

  if (typeof fromFile === "string" && fromFile.trim() !== "") {
    return fromFile.trim();
  }

  return "";
}

function parseArgs(argv) {
  const parsed = { mode: "create", richMenuId: "", help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--list" || arg === "list") {
      parsed.mode = "list";
    } else if (arg === "--help" || arg === "-h" || arg === "help") {
      parsed.help = true;
    } else if (arg === "--delete" || arg === "delete") {
      parsed.mode = "delete";
      const next = argv[i + 1];

      if (typeof next === "string" && !next.startsWith("-")) {
        parsed.richMenuId = next;
        i += 1;
      }
    } else if (arg.startsWith("--delete=")) {
      parsed.mode = "delete";
      parsed.richMenuId = arg.slice("--delete=".length);
    } else if (arg.startsWith("--") && parsed.mode === "delete" && parsed.richMenuId === "") {
      parsed.richMenuId = arg;
    }
  }

  return parsed;
}

function printHelp() {
  console.log("วิธีใช้: node scripts/rich-menu.mjs [คำสั่ง]");
  console.log("");
  console.log("  (ไม่ใส่คำสั่ง)        สร้างเมนู อัปโหลดรูป แล้วตั้งเป็นเมนูหลัก");
  console.log("  --list              แสดงเมนูทั้งหมดของ OA");
  console.log("  --delete <id>       ลบเมนูตาม richMenuId");
  console.log("  --help              แสดงข้อความนี้");
  console.log("");
  console.log("ต้องมี LINE_CHANNEL_ACCESS_TOKEN และ LIFF_ID (จาก environment หรือ .dev.vars)");
}

function abort(message) {
  console.error(message);
  process.exit(1);
}

function reportFailure(step, status, body) {
  console.error(`${step} ไม่สำเร็จ (HTTP ${status})`);
  const trimmed = typeof body === "string" ? body.trim() : "";

  if (trimmed !== "") {
    console.error(trimmed);
  }

  process.exit(1);
}

async function request(method, url, token, options = {}) {
  const headers = { Authorization: `Bearer ${token}` };

  if (options.contentType !== undefined) {
    headers["Content-Type"] = options.contentType;
  }

  let response;

  try {
    response = await fetch(url, { method, headers, body: options.body });
  } catch (error) {
    abort(`เรียก LINE API ไม่สำเร็จ (${method} ${url}) — ${error instanceof Error ? error.message : String(error)}`);
  }

  const text = await response.text();
  let json = null;

  if (text.trim() !== "") {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return { ok: response.ok, status: response.status, json, text };
}

function buildMenuBody(liffId) {
  return {
    size: SIZE,
    selected: true,
    name: MENU_NAME,
    chatBarText: CHAT_BAR_TEXT,
    areas: [
      { bounds: { x: 0, y: 0, width: 1250, height: 843 }, action: { type: "uri", uri: `https://liff.line.me/${liffId}` } },
      { bounds: { x: 1250, y: 0, width: 1250, height: 843 }, action: { type: "message", text: "ส่งสลิป" } },
      { bounds: { x: 0, y: 843, width: 1250, height: 843 }, action: { type: "message", text: "บิลของฉัน" } },
      { bounds: { x: 1250, y: 843, width: 1250, height: 843 }, action: { type: "message", text: "ติดต่อเจ้าของ" } }
    ]
  };
}

async function listMenus(token) {
  const result = await request("GET", `${MESSAGING_API}/richmenu/list`, token);

  if (!result.ok) {
    reportFailure("ดึงรายการเมนู", result.status, result.text);
  }

  const menus = Array.isArray(result.json?.richmenus) ? result.json.richmenus : [];
  console.log(`พบเมนูทั้งหมด ${menus.length} รายการ`);

  for (const menu of menus) {
    const areas = Array.isArray(menu.areas) ? menu.areas.length : 0;
    const size = menu.size ? `${menu.size.width}x${menu.size.height}` : "ไม่ทราบขนาด";
    console.log(`- ${menu.richMenuId} | ${menu.name ?? "ไม่มีชื่อ"} | ${size} | ${areas} ปุ่ม | selected=${menu.selected === true} | chatBarText=${menu.chatBarText ?? "-"}`);
  }
}

async function deleteMenu(token, richMenuId) {
  if (richMenuId === "") {
    abort("ต้องระบุ richMenuId ที่ต้องการลบ เช่น --delete richmenu-xxxxxxxx");
  }

  const result = await request("DELETE", `${MESSAGING_API}/richmenu/${richMenuId}`, token);

  if (!result.ok) {
    reportFailure("ลบเมนู", result.status, result.text);
  }

  console.log(`ลบเมนูแล้ว ${richMenuId}`);
}

async function createMenu(token, liffId) {
  let image;

  try {
    image = readFileSync(IMAGE_PATH);
  } catch {
    abort(`ไม่พบไฟล์รูป ${IMAGE_PATH} — สร้างรูปก่อนด้วยการเรนเดอร์ assets/rich-menu/rich-menu.html`);
  }

  if (image.length === 0) {
    abort(`ไฟล์รูป ${IMAGE_PATH} ว่างเปล่า`);
  }

  const create = await request("POST", `${MESSAGING_API}/richmenu`, token, {
    contentType: "application/json",
    body: JSON.stringify(buildMenuBody(liffId))
  });

  if (!create.ok) {
    reportFailure("สร้างเมนู", create.status, create.text);
  }

  const richMenuId = create.json?.richMenuId;

  if (typeof richMenuId !== "string" || richMenuId === "") {
    reportFailure("สร้างเมนู", create.status, create.text);
  }

  console.log(`สร้างเมนูแล้ว ${richMenuId}`);

  const upload = await request("POST", `${DATA_API}/richmenu/${richMenuId}/content`, token, {
    contentType: "image/png",
    body: image
  });

  if (!upload.ok) {
    reportFailure("อัปโหลดรูปเมนู", upload.status, upload.text);
  }

  console.log(`อัปโหลดรูปแล้ว ${richMenuId}`);

  const setDefault = await request("POST", `${MESSAGING_API}/user/all/richmenu/${richMenuId}`, token);

  if (!setDefault.ok) {
    reportFailure("ตั้งเมนูหลัก", setDefault.status, setDefault.text);
  }

  console.log(`ตั้งเป็นเมนูหลักแล้ว ${richMenuId}`);
  console.log(`เมนูพร้อมใช้งาน richMenuId=${richMenuId}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const local = loadLocalVars();
  const token = resolveValue(local, "LINE_CHANNEL_ACCESS_TOKEN");

  if (token === "") {
    abort("ไม่พบ LINE_CHANNEL_ACCESS_TOKEN — ใส่ค่าใน .dev.vars หรือตั้งเป็น environment variable ก่อนรัน");
  }

  if (args.mode === "list") {
    await listMenus(token);
    return;
  }

  if (args.mode === "delete") {
    await deleteMenu(token, args.richMenuId);
    return;
  }

  const liffId = resolveValue(local, "LIFF_ID");

  if (liffId === "") {
    abort("ไม่พบ LIFF_ID — ใส่ LIFF_ID ของฟอร์มลงทะเบียนใน .dev.vars หรือรันด้วย LIFF_ID=xxxxxxxx ก่อน จึงจะสร้างเมนูได้ (ไม่งั้นปุ่มลงทะเบียนผู้เช่าจะเป็นลิงก์ตาย)");
  }

  await createMenu(token, liffId);
}

await main();
