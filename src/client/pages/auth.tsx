import { useEffect, useState, type ReactNode } from "react";
import {
  ApiError,
  fetchInvitePreview,
  googleSignInUrl,
  type InvitePreview,
} from "../api";
import { Button, Card, Monogram, Skeleton } from "../ui";
import { dateLabel } from "./bills-shared";

/**
 * เตือนเมื่อเปิดหน้านี้ในเบราว์เซอร์ในแอป LINE
 *
 * Google **ปฏิเสธ** คำขอ OAuth ที่มาจาก embedded webview (ตอบ disallowed_useragent
 * ตั้งแต่ ก.ค. 2023) กดปุ่มด้านล่างจึงเจอหน้า "Access blocked" ของ Google ทันที
 * ไม่ใช่ความผิดพลาดของผู้ใช้และเขาแก้เองไม่ได้ถ้าไม่รู้ — จึงบอกให้เปิดในเบราว์เซอร์
 * ปกติ และให้ปุ่มคัดลอกลิงก์สำหรับวางใน Safari/Chrome
 *
 * ลิงก์ที่บอทส่งมาเติม `openExternalBrowser=1` แล้วจึงไม่ตกมาที่นี่ แต่คนที่จำ URL
 * เอง เปิดจากประวัติ หรือกดลิงก์เก่ายังเจอเคสนี้ได้
 */
function useLineInAppBrowser(): boolean {
  const [inLine, setInLine] = useState(false);

  useEffect(() => {
    // LINE ต่อท้าย UA ของ WebView ตัวเองด้วย "Line/" ทุกแพลตฟอร์ม
    setInLine(/\bLine\//.test(navigator.userAgent));
  }, []);

  return inLine;
}

function LineBrowserNotice({ detail }: { detail: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-status-review-fg/30 bg-status-review-bg px-3 py-2.5 text-xs"
      role="alert"
    >
      <span className="ms text-[16px] text-status-review-fg" aria-hidden="true">
        warning
      </span>
      <span className="min-w-0">
        <span className="block text-status-review-fg">
          เปิดหน้านี้ในเบราว์เซอร์ของเครื่องก่อนเข้าสู่ระบบ
        </span>
        <span className="mt-0.5 block text-steel">{detail}</span>
        <button
          type="button"
          className="mt-1.5 text-electric-blue underline underline-offset-2"
          onClick={() => {
            void navigator.clipboard
              .writeText(window.location.href)
              .then(() => {
                setCopied(true);
              })
              .catch(() => {
                // คัดลอกไม่ได้ก็ไม่เป็นไร ที่อยู่ยังอยู่ในแถบที่อยู่ของเบราว์เซอร์
              });
          }}
        >
          {copied ? "คัดลอกลิงก์แล้ว" : "คัดลอกลิงก์นี้"}
        </button>
      </span>
    </div>
  );
}

/** กล่องข้อผิดพลาดระดับหน้า — ทุกหน้าของการเข้าสู่ระบบใช้ร่วมกัน */
function FormNotice({
  message,
  detail,
}: {
  message: string;
  detail?: string;
}) {
  return (
    <div
      className="flex items-start gap-2 rounded-lg border border-ash bg-danger-soft px-3 py-2.5 text-xs"
      role="alert"
    >
      <span className="ms text-[16px] text-danger" aria-hidden="true">
        error
      </span>
      <span className="min-w-0">
        <span className="block text-danger">{message}</span>
        {detail !== undefined && (
          <span className="mt-0.5 block text-steel">{detail}</span>
        )}
      </span>
    </div>
  );
}

/** รหัสสาเหตุที่เซิร์ฟเวอร์ส่งกลับมาทาง query เมื่อเข้าสู่ระบบด้วย Google ไม่สำเร็จ */
const googleReasonMessages: Record<string, string> = {
  google_disabled: "เซิร์ฟเวอร์นี้ยังไม่ได้ตั้งค่า Google จึงเข้าใช้งานไม่ได้",
  denied: "ยกเลิกการเข้าสู่ระบบด้วย Google",
  state: "การยืนยันตัวตนไม่สมบูรณ์ กรุณาเริ่มใหม่จากหน้านี้",
  google_failed: "ยืนยันกับ Google ไม่สำเร็จ กรุณาลองใหม่",
  no_family: "บัญชีนี้ยังไม่ได้อยู่ในครอบครัวใด กรุณาให้เจ้าของหอออกคำเชิญ",
  not_invited: "อีเมลนี้ยังไม่ได้รับคำเชิญจากเจ้าของหอ",
  family_full: "ครอบครัวนี้มีสมาชิกครบแล้ว",
};

/** อ่านเหตุผลจาก query แล้วลบทิ้ง เพื่อไม่ให้ข้อความเดิมกลับมาอีกตอนกด refresh */
function useGoogleFailureNotice(): string | null {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get("auth") !== "error") {
      return;
    }

    const reason = params.get("reason") ?? "";
    setNotice(googleReasonMessages[reason] ?? "เข้าสู่ระบบด้วย Google ไม่สำเร็จ");

    params.delete("auth");
    params.delete("reason");

    const rest = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${rest === "" ? "" : `?${rest}`}${window.location.hash}`,
    );
  }, []);

  return notice;
}

function AuthLayout({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-screen items-start justify-items-center bg-canvas-white px-4 py-10 md:place-items-center md:py-16">
      <div className="w-full max-w-[420px]">
        <div className="mb-5 flex items-center gap-2.5">
          <Monogram className="h-11 w-11" />
          <span>
            <span className="block text-sm font-semibold text-charcoal">
              หอพักวังจันทร์
            </span>
            <span className="block text-[11px] text-fog">ระบบจัดการหอพัก</span>
          </span>
        </div>
        <Card>
          <h1 className="text-xl text-charcoal">{title}</h1>
          <p className="mt-1 text-sm text-steel">{description}</p>
          <div className="mt-4">{children}</div>
        </Card>
      </div>
    </div>
  );
}

/**
 * ทางเข้าเดียวของทั้งระบบ
 *
 * เป็นปุ่มทึบสีเข้ม ไม่ใช่ปุ่มขอบจางแบบเดิม เพราะเมื่อไม่มีช่องกรอกอีเมลกับ
 * รหัสผ่านอีกแล้ว มันคือการกระทำเดียวที่หน้านี้มี (DESIGN.md: หนึ่งการกระทำ
 * หลักต่อหนึ่งหน้าจอ)
 *
 * ถ้าตอนนี้มีที่หมายอยู่ใน fragment (เช่นเปิดจากปุ่ม "เปิดบิลในเว็บ" ในแชท LINE)
 * ต้องแนบไปด้วย ไม่งั้นล็อกอินเสร็จแล้วจะตกไปที่แดชบอร์ดและที่หมายหายไป
 */
function GoogleButton({ label }: { label: string }) {
  return (
    <Button
      variant="primary"
      className="w-full justify-center"
      icon="account_circle"
      onClick={() => {
        window.location.href = googleSignInUrl(window.location.hash);
      }}
    >
      {label}
    </Button>
  );
}

export function AuthScreen() {
  const googleNotice = useGoogleFailureNotice();
  const lineBrowser = useLineInAppBrowser();

  return (
    <AuthLayout
      title="เข้าสู่ระบบ"
      description="ใช้บัญชี Google ที่ผูกกับหอนี้"
    >
      {lineBrowser && (
        <LineBrowserNotice detail="Google ไม่อนุญาตให้เข้าสู่ระบบจากเบราว์เซอร์ในแอป LINE จึงต้องเปิดลิงก์นี้ใน Safari หรือ Chrome แทน" />
      )}

      {googleNotice !== null && (
        <div className={lineBrowser ? "mt-3" : ""}>
          <FormNotice message={googleNotice} />
        </div>
      )}

      <div className={lineBrowser || googleNotice !== null ? "mt-4" : ""}>
        <GoogleButton label="เข้าสู่ระบบด้วย Google" />
      </div>

      <p className="mt-4 border-t border-ash pt-3 text-xs text-fog">
        สมาชิกในครอบครัวเข้าได้ด้วยคำเชิญจากเจ้าของหอเท่านั้น
      </p>
    </AuthLayout>
  );
}

export function InviteAcceptScreen({
  token,
  onLeave,
}: {
  token: string;
  onLeave: () => void;
}) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const lineBrowser = useLineInAppBrowser();

  /**
   * ถามข้อมูลคำเชิญก่อนให้กดปุ่ม
   *
   * คนที่เปิดลิงก์จาก LINE ต้องรู้ว่าใครเชิญให้ไปหอไหน และต้องรู้ทันทีถ้าลิงก์
   * ใช้ไม่ได้ แทนที่จะเสียเวลากดเข้าสู่ระบบแล้วเพิ่งเจอว่าตัวเองไม่ได้รับเชิญ
   */
  useEffect(() => {
    let cancelled = false;

    // ล้างของเดิมก่อนยิงใหม่ เพราะเบราว์เซอร์เปลี่ยนแค่ hash ได้ (แก้ลิงก์เอง)
    // ถ้าไม่ล้าง หน้าจะค้างอีเมลของคำเชิญอันก่อนไว้ทั้งที่โทเคนเปลี่ยนแล้ว
    setPreview(null);
    setPreviewError(null);
    setChecking(true);

    void fetchInvitePreview(token)
      .then((data) => {
        if (!cancelled) {
          setPreview(data);
        }
      })
      .catch((failure: unknown) => {
        if (!cancelled) {
          setPreviewError(
            failure instanceof ApiError ? failure.message : "เปิดคำเชิญไม่สำเร็จ",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setChecking(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (checking) {
    return (
      <AuthLayout title="รับคำเชิญ" description="กำลังตรวจสอบคำเชิญ">
        <div className="grid justify-items-center gap-3" aria-busy="true">
          <Skeleton className="h-2 w-40" />
        </div>
      </AuthLayout>
    );
  }

  // ลิงก์ใช้ไม่ได้ — บอกสาเหตุและทางออก ไม่ปล่อยให้กดปุ่มที่ไม่มีทางสำเร็จ
  if (preview === null) {
    return (
      <AuthLayout title="รับคำเชิญ" description="ลิงก์นี้ใช้ไม่ได้แล้ว">
        <FormNotice
          message={previewError ?? "เปิดคำเชิญไม่สำเร็จ"}
          detail="ขอคำเชิญใหม่จากเจ้าของหอ แล้วเปิดลิงก์นั้นอีกครั้ง"
        />
        <div className="mt-4 border-t border-ash pt-3">
          <button
            type="button"
            className="text-xs text-electric-blue underline underline-offset-2"
            onClick={onLeave}
          >
            ไปหน้าเข้าสู่ระบบ
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="รับคำเชิญ"
      description={`เข้าร่วม${preview.familyName}ด้วยบัญชี Google`}
    >
      <dl className="grid gap-1.5 rounded-lg border border-ash bg-paper-mist px-3 py-2.5 text-xs">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-steel">อีเมลที่ถูกเชิญ</dt>
          <dd className="num truncate text-charcoal">{preview.email}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-steel">ใช้ได้ถึง</dt>
          <dd className="num text-charcoal">{dateLabel(preview.expiresAt)}</dd>
        </div>
      </dl>

      {lineBrowser && (
        <div className="mt-4">
          <LineBrowserNotice detail="ลิงก์คำเชิญเปิดจากแอป LINE ได้ แต่การเข้าสู่ระบบด้วย Google ต้องทำใน Safari หรือ Chrome — คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์ของเครื่อง" />
        </div>
      )}

      <div className="mt-4">
        <GoogleButton label="เข้าสู่ระบบด้วย Google" />
      </div>

      <p className="mt-3 text-xs text-fog">
        เลือกบัญชี Google ที่ใช้อีเมล {preview.email} เท่านั้น
        แล้วระบบจะพาเข้าครอบครัวให้เอง
      </p>

      <div className="mt-4 border-t border-ash pt-3">
        <button
          type="button"
          className="text-xs text-electric-blue underline underline-offset-2"
          onClick={onLeave}
        >
          ไปหน้าเข้าสู่ระบบ
        </button>
      </div>
    </AuthLayout>
  );
}

export function AuthSplash() {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas-white px-4">
      <div
        className="grid w-full max-w-[360px] justify-items-center gap-3"
        aria-busy="true"
      >
        <Monogram className="h-12 w-12" />
        <p className="text-sm text-steel">กำลังตรวจสอบเซสชัน</p>
        <Skeleton className="h-2 w-40" />
      </div>
    </div>
  );
}
