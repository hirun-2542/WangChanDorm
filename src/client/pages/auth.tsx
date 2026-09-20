import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ApiError,
  acceptInvite,
  fetchInvitePreview,
  fetchMe,
  googleSignInPath,
  login,
  setupOwner,
  type AuthUser,
  type InvitePreview,
} from "../api";
import { Button, Card, Field, Monogram, PasswordField, Skeleton } from "../ui";
import { dateLabel } from "./bills-shared";

function fieldErrorOf(
  error: ApiError | null,
  field: string,
): string | undefined {
  return error !== null && error.field === field ? error.message : undefined;
}

/** กล่องข้อผิดพลาดระดับฟอร์ม — ทุกหน้าของการเข้าสู่ระบบใช้ร่วมกัน */
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

/**
 * บอกสาเหตุตามสถานะที่เซิร์ฟเวอร์ตอบ เพราะผู้ใช้ต้องรู้ว่าต้องแก้ที่ใด
 *
 * ไม่พูดถึงตัวแปรสภาพแวดล้อมหรือคำว่า "เซิร์ฟเวอร์" — คนที่เห็นหน้านี้คือเจ้าของหอ
 * ไม่ใช่คนดูแลระบบ และข้อความต้องบอกว่าให้ทำอะไรต่อ ไม่ใช่บอกว่าอะไรผิด
 */
function setupDetail(status: number): string | undefined {
  switch (status) {
    case 503:
      return "ระบบยังไม่ได้ตั้งค่าอีเมลเจ้าของหอ จึงตั้งเจ้าของหอตอนนี้ไม่ได้";
    case 409:
      return "หอนี้มีเจ้าของแล้ว ให้เข้าสู่ระบบด้วยบัญชีเดิม";
    case 403:
      return "อีเมลนี้ไม่ตรงกับเจ้าของหอที่ตั้งไว้สำหรับหอนี้";
    case 429:
      return "พยายามหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่";
    default:
      return undefined;
  }
}

/** รหัสสาเหตุที่เซิร์ฟเวอร์ส่งกลับมาทาง query เมื่อล็อกอินด้วย Google ไม่สำเร็จ */
const googleReasonMessages: Record<string, string> = {
  google_disabled: "เซิร์ฟเวอร์นี้ยังไม่ได้ตั้งค่า Google จึงยังใช้ปุ่มนี้ไม่ได้",
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

function LoginForm({
  onSignedIn,
  onFirstRun,
  googleNotice,
}: {
  onSignedIn: (user: AuthUser) => void;
  onFirstRun: () => void;
  googleNotice: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);

    if (busy || email.trim() === "" || password === "") {
      return;
    }

    setBusy(true);
    setError(null);

    void login(email.trim(), password)
      .then(() => fetchMe())
      .then(onSignedIn)
      .catch((failure: unknown) => {
        setError(
          failure instanceof ApiError
            ? failure
            : new ApiError("เข้าสู่ระบบไม่สำเร็จ", "UNKNOWN"),
        );
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const notice = error !== null && error.field === undefined ? error : null;

  return (
    <AuthLayout
      title="เข้าสู่ระบบ"
      description="ใช้อีเมลและรหัสผ่านของบัญชีที่ตั้งไว้แล้ว หรือใช้บัญชี Google"
    >
      {googleNotice !== null && <FormNotice message={googleNotice} />}

      <div className={googleNotice === null ? "" : "mt-4"}>
        <Button
          variant="secondary"
          className="w-full justify-center"
          icon="account_circle"
          onClick={() => {
            window.location.href = googleSignInPath;
          }}
        >
          เข้าสู่ระบบด้วย Google
        </Button>
      </div>

      <div className="my-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-ash" aria-hidden="true" />
        <span className="text-[11px] text-fog">หรือ</span>
        <span className="h-px flex-1 bg-ash" aria-hidden="true" />
      </div>

      <form className="grid gap-4" onSubmit={submit} noValidate>
        <Field
          label="อีเมล"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="owner@example.com"
          autoComplete="username"
          name="email"
          error={
            fieldErrorOf(error, "email") ??
            (submitted && email.trim() === "" ? "กรอกอีเมล" : undefined)
          }
        />
        <PasswordField
          label="รหัสผ่าน"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          name="password"
          error={
            fieldErrorOf(error, "password") ??
            (submitted && password === "" ? "กรอกรหัสผ่าน" : undefined)
          }
        />
        {notice !== null && <FormNotice message={notice.message} />}
        <Button variant="primary" type="submit" icon="login" disabled={busy}>
          {busy ? "กำลังเข้าสู่ระบบ" : "เข้าสู่ระบบ"}
        </Button>
      </form>

      <div className="mt-4 border-t border-ash pt-3">
        <p className="text-xs text-fog">
          สมาชิกในครอบครัวเข้าได้ด้วยคำเชิญจากเจ้าของหอเท่านั้น
          และลืมรหัสผ่านให้ใช้ปุ่ม Google ด้านบนได้ถ้าอีเมลตรงกัน
        </p>
        <button
          type="button"
          className="mt-1.5 text-xs text-electric-blue underline underline-offset-2"
          onClick={onFirstRun}
        >
          ตั้งเจ้าของหอครั้งแรก
        </button>
      </div>
    </AuthLayout>
  );
}

function SetupForm({
  onSignedIn,
  onBackToLogin,
}: {
  onSignedIn: (user: AuthUser) => void;
  onBackToLogin: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm !== "" && confirm !== password;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);

    if (
      busy ||
      displayName.trim() === "" ||
      email.trim() === "" ||
      password === "" ||
      password !== confirm
    ) {
      return;
    }

    setBusy(true);
    setError(null);

    const trimmedFamilyName = familyName.trim();

    void setupOwner({
      email: email.trim(),
      displayName: displayName.trim(),
      password,
      ...(trimmedFamilyName === "" ? {} : { familyName: trimmedFamilyName }),
    })
      .then(onSignedIn)
      .catch((failure: unknown) => {
        setError(
          failure instanceof ApiError
            ? failure
            : new ApiError("ตั้งเจ้าของหอไม่สำเร็จ", "UNKNOWN"),
        );
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const notice = error !== null && error.field === undefined ? error : null;

  return (
    <AuthLayout
      title="ตั้งเจ้าของหอ"
      description="ใช้ครั้งแรกเมื่อหอนี้ยังไม่มีเจ้าของ กรอกอีเมลเจ้าของหอที่ตั้งไว้สำหรับหอนี้"
    >
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <Field
          label="ชื่อที่แสดง"
          value={displayName}
          onChange={setDisplayName}
          placeholder="เช่น สมชาย"
          autoComplete="name"
          name="displayName"
          error={
            fieldErrorOf(error, "displayName") ??
            (submitted && displayName.trim() === ""
              ? "กรอกชื่อที่แสดง"
              : undefined)
          }
        />
        <Field
          label="อีเมล"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="owner@example.com"
          helper="ต้องเป็นอีเมลเจ้าของหอที่ตั้งไว้สำหรับหอนี้"
          autoComplete="email"
          name="email"
          error={
            fieldErrorOf(error, "email") ??
            (submitted && email.trim() === "" ? "กรอกอีเมล" : undefined)
          }
        />
        <PasswordField
          label="รหัสผ่าน"
          value={password}
          onChange={setPassword}
          helper="อย่างน้อย 12 ตัวอักษร"
          autoComplete="new-password"
          name="password"
          error={
            fieldErrorOf(error, "password") ??
            (submitted && password === "" ? "กรอกรหัสผ่าน" : undefined)
          }
        />
        <PasswordField
          label="ยืนยันรหัสผ่าน"
          value={confirm}
          onChange={setConfirm}
          matches={password}
          autoComplete="new-password"
          name="confirmPassword"
          error={submitted && confirm === "" ? "กรอกรหัสผ่านอีกครั้ง" : undefined}
        />
        <Field
          label="ชื่อหอ"
          value={familyName}
          onChange={setFamilyName}
          helper="ตั้งให้หอนี้ได้เลย เว้นว่างได้ถ้าไม่ต้องการเปลี่ยน"
          autoComplete="organization"
          name="familyName"
          error={fieldErrorOf(error, "familyName")}
        />
        {notice !== null && (
          <FormNotice
            message={notice.message}
            detail={setupDetail(notice.status)}
          />
        )}
        <Button
          variant="primary"
          type="submit"
          icon="shield_person"
          disabled={busy || mismatch}
        >
          {busy ? "กำลังตั้งค่า" : "ตั้งเจ้าของหอ"}
        </Button>
      </form>

      <div className="mt-4 border-t border-ash pt-3">
        <button
          type="button"
          className="text-xs text-electric-blue underline underline-offset-2"
          onClick={onBackToLogin}
        >
          กลับหน้าเข้าสู่ระบบ
        </button>
      </div>
    </AuthLayout>
  );
}

export function AuthScreen({
  onSignedIn,
}: {
  onSignedIn: (user: AuthUser) => void;
}) {
  const [mode, setMode] = useState<"login" | "setup">("login");
  const googleNotice = useGoogleFailureNotice();

  if (mode === "setup") {
    return (
      <SetupForm
        onSignedIn={onSignedIn}
        onBackToLogin={() => {
          setMode("login");
        }}
      />
    );
  }

  return (
    <LoginForm
      onSignedIn={onSignedIn}
      googleNotice={googleNotice}
      onFirstRun={() => {
        setMode("setup");
      }}
    />
  );
}

export function InviteAcceptScreen({
  token,
  onSignedIn,
  onLeave,
}: {
  token: string;
  onSignedIn: (user: AuthUser) => void;
  onLeave: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  const mismatch = confirm !== "" && confirm !== password;

  /**
   * ถามข้อมูลคำเชิญก่อนให้ตั้งรหัสผ่าน
   *
   * คนที่เปิดลิงก์จาก LINE ต้องรู้ว่าใครเชิญให้ไปหอไหน และควรรู้ทันทีถ้าลิงก์ใช้ไม่ได้
   * แทนที่จะกรอกครบทุกช่องแล้วเพิ่งเจอข้อความปฏิเสธตอนกดส่ง
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);

    if (
      busy ||
      displayName.trim() === "" ||
      password === "" ||
      password !== confirm
    ) {
      return;
    }

    setBusy(true);
    setError(null);

    void acceptInvite({
      token,
      displayName: displayName.trim(),
      password,
    })
      .then(() => fetchMe())
      .then(onSignedIn)
      .catch((failure: unknown) => {
        setError(
          failure instanceof ApiError
            ? failure
            : new ApiError("รับคำเชิญไม่สำเร็จ", "UNKNOWN"),
        );
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const notice =
    error !== null && (error.field === undefined || error.field === "token")
      ? error
      : null;

  if (checking) {
    return (
      <AuthLayout title="รับคำเชิญ" description="กำลังตรวจสอบคำเชิญ">
        <div className="grid justify-items-center gap-3" aria-busy="true">
          <Skeleton className="h-2 w-40" />
        </div>
      </AuthLayout>
    );
  }

  // ลิงก์ใช้ไม่ได้ — บอกสาเหตุและทางออก ไม่ปล่อยให้กรอกฟอร์มที่ไม่มีทางสำเร็จ
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
      description={`ตั้งชื่อที่แสดงและรหัสผ่านเพื่อเข้าใช้งาน${preview.familyName}`}
    >
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <Field
          label="ชื่อที่แสดง"
          value={displayName}
          onChange={setDisplayName}
          placeholder="เช่น สมชาย"
          autoComplete="name"
          name="displayName"
          error={
            fieldErrorOf(error, "displayName") ??
            (submitted && displayName.trim() === ""
              ? "กรอกชื่อที่แสดง"
              : undefined)
          }
        />
        <Field
          label="อีเมลที่ถูกเชิญ"
          type="email"
          value={preview.email}
          autoComplete="username"
          name="email"
          readOnly
          helper={`คำเชิญนี้ใช้ได้ครั้งเดียว หมดอายุ ${dateLabel(preview.expiresAt)}`}
        />
        <PasswordField
          label="รหัสผ่าน"
          value={password}
          onChange={setPassword}
          helper="อย่างน้อย 12 ตัวอักษร · ถ้ามีบัญชีอยู่แล้วให้ใช้รหัสผ่านเดิมของบัญชีนั้น"
          autoComplete="new-password"
          name="password"
          error={
            fieldErrorOf(error, "password") ??
            (submitted && password === "" ? "กรอกรหัสผ่าน" : undefined)
          }
        />
        <PasswordField
          label="ยืนยันรหัสผ่าน"
          value={confirm}
          onChange={setConfirm}
          matches={password}
          autoComplete="new-password"
          name="confirmPassword"
          error={submitted && confirm === "" ? "กรอกรหัสผ่านอีกครั้ง" : undefined}
        />
        {notice !== null && (
          <FormNotice
            message={notice.message}
            detail={
              notice.status === 400
                ? "ขอคำเชิญใหม่จากเจ้าของหอ แล้วเปิดลิงก์นั้นอีกครั้ง"
                : undefined
            }
          />
        )}
        <Button
          variant="primary"
          type="submit"
          icon="group_add"
          disabled={busy || mismatch}
        >
          {busy ? "กำลังรับคำเชิญ" : "รับคำเชิญและเข้าใช้งาน"}
        </Button>
      </form>

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
