import { useState, type FormEvent, type ReactNode } from "react";
import {
  ApiError,
  acceptInvite,
  bootstrap,
  fetchMe,
  login,
  type AuthUser,
} from "../api";
import { Button, Card, Field, Monogram, Skeleton } from "../ui";

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

/** บอกสาเหตุตามสถานะที่เซิร์ฟเวอร์ตอบ เพราะผู้ใช้ต้องรู้ว่าต้องแก้ที่ใด */
function bootstrapDetail(status: number): string | undefined {
  switch (status) {
    case 503:
      return "เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า BOOTSTRAP_SECRET จึงตั้งเจ้าของระบบไม่ได้";
    case 409:
      return "ระบบมีเจ้าของอยู่แล้ว ให้เข้าสู่ระบบด้วยบัญชีเดิม";
    case 403:
      return "รหัสเริ่มต้นระบบไม่ตรงกับที่ตั้งไว้บนเซิร์ฟเวอร์";
    case 429:
      return "พยายามหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่";
    default:
      return undefined;
  }
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
}: {
  onSignedIn: (user: AuthUser) => void;
  onFirstRun: () => void;
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
      description="ใช้อีเมลและรหัสผ่านของบัญชีที่ตั้งไว้แล้ว"
    >
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <Field
          label="อีเมล"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="owner@example.com"
          error={
            fieldErrorOf(error, "email") ??
            (submitted && email.trim() === "" ? "กรอกอีเมล" : undefined)
          }
        />
        <Field
          label="รหัสผ่าน"
          type="password"
          value={password}
          onChange={setPassword}
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
          ยังไม่มีบัญชี ระบบเปิดรับสมาชิกด้วยคำเชิญจากเจ้าของหอเท่านั้น
        </p>
        <button
          type="button"
          className="mt-1.5 text-xs text-electric-blue underline underline-offset-2"
          onClick={onFirstRun}
        >
          ตั้งค่าเจ้าของระบบครั้งแรก
        </button>
      </div>
    </AuthLayout>
  );
}

function BootstrapForm({
  onSignedIn,
  onBackToLogin,
}: {
  onSignedIn: (user: AuthUser) => void;
  onBackToLogin: () => void;
}) {
  const [secret, setSecret] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);

    if (
      busy ||
      secret === "" ||
      displayName.trim() === "" ||
      email.trim() === "" ||
      password === ""
    ) {
      return;
    }

    setBusy(true);
    setError(null);

    const trimmedFamilyName = familyName.trim();

    void bootstrap({
      secret,
      email: email.trim(),
      displayName: displayName.trim(),
      password,
      ...(trimmedFamilyName === "" ? {} : { familyName: trimmedFamilyName }),
    })
      .then((result) => {
        onSignedIn(result.user);
      })
      .catch((failure: unknown) => {
        setError(
          failure instanceof ApiError
            ? failure
            : new ApiError("ตั้งค่าเจ้าของระบบไม่สำเร็จ", "UNKNOWN"),
        );
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const notice = error !== null && error.field === undefined ? error : null;

  return (
    <AuthLayout
      title="ตั้งค่าเจ้าของระบบ"
      description="ใช้ครั้งแรกเมื่อหอนี้ยังไม่มีเจ้าของ ต้องมีรหัสเริ่มต้นระบบจากเซิร์ฟเวอร์"
    >
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <Field
          label="รหัสเริ่มต้นระบบ"
          type="password"
          value={secret}
          onChange={setSecret}
          helper="ค่าที่ตั้งไว้ใน BOOTSTRAP_SECRET บนเซิร์ฟเวอร์"
          error={fieldErrorOf(error, "secret")}
        />
        <Field
          label="ชื่อที่แสดง"
          value={displayName}
          onChange={setDisplayName}
          placeholder="เช่น สมชาย"
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
          helper="ใช้เข้าสู่ระบบครั้งต่อไป"
          error={
            fieldErrorOf(error, "email") ??
            (submitted && email.trim() === "" ? "กรอกอีเมล" : undefined)
          }
        />
        <Field
          label="รหัสผ่าน"
          type="password"
          value={password}
          onChange={setPassword}
          helper="อย่างน้อย 12 ตัวอักษร"
          error={
            fieldErrorOf(error, "password") ??
            (submitted && password === "" ? "กรอกรหัสผ่าน" : undefined)
          }
        />
        <Field
          label="ชื่อครอบครัว"
          value={familyName}
          onChange={setFamilyName}
          helper="เว้นว่างได้ถ้าระบบมีข้อมูลหอเดิมอยู่แล้ว ระบบจะรับช่วงข้อมูลนั้นให้"
          error={fieldErrorOf(error, "familyName")}
        />
        {notice !== null && (
          <FormNotice
            message={notice.message}
            detail={bootstrapDetail(notice.status)}
          />
        )}
        <Button variant="primary" type="submit" icon="shield_person" disabled={busy}>
          {busy ? "กำลังตั้งค่า" : "ตั้งค่าเจ้าของระบบ"}
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
  const [mode, setMode] = useState<"login" | "bootstrap">("login");

  if (mode === "bootstrap") {
    return (
      <BootstrapForm
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
      onFirstRun={() => {
        setMode("bootstrap");
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
  const [error, setError] = useState<ApiError | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);

    if (busy || displayName.trim() === "" || password === "") {
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

  return (
    <AuthLayout
      title="รับคำเชิญ"
      description="ตั้งชื่อที่แสดงและรหัสผ่านเพื่อเข้าใช้งานหอที่เชิญคุณ"
    >
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <Field
          label="ชื่อที่แสดง"
          value={displayName}
          onChange={setDisplayName}
          placeholder="เช่น สมชาย"
          error={
            fieldErrorOf(error, "displayName") ??
            (submitted && displayName.trim() === ""
              ? "กรอกชื่อที่แสดง"
              : undefined)
          }
        />
        <Field
          label="รหัสผ่าน"
          type="password"
          value={password}
          onChange={setPassword}
          helper="อย่างน้อย 12 ตัวอักษร · ถ้ามีบัญชีอยู่แล้วให้ใช้รหัสผ่านเดิมของบัญชีนั้น"
          error={
            fieldErrorOf(error, "password") ??
            (submitted && password === "" ? "กรอกรหัสผ่าน" : undefined)
          }
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
        <Button variant="primary" type="submit" icon="group_add" disabled={busy}>
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
