import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError, changePassword, type AuthUser } from "./api";
import { useAuth } from "./auth";
import { Button, PasswordField, RoleBadge } from "./ui";

/**
 * แผงบัญชีที่เปิดจากชื่อผู้ใช้บนแถบบน
 *
 * เดิมเป็นโมดัลกลางจอ ทั้งที่คำถามที่คนกดเข้ามาหาคือ "ตอนนี้ฉันเข้าใช้ด้วยบัญชีอะไร"
 * กับ "ออกจากระบบ" ส่วนฟอร์มเปลี่ยนรหัสผ่านเป็นของที่ต้องตั้งใจเข้ามาทำ
 * จึงแยกเป็นสองหน้าจอในแผงเดียว — ข้อมูลบัญชีมาก่อน แล้วค่อยกดเข้าฟอร์ม
 *
 * แผงนี้ถูกสร้างใหม่ทุกครั้งที่เปิด (unmount ตอนปิด) ข้อความ error และรหัสผ่าน
 * ที่พิมพ์ค้างไว้จึงไม่หลงเหลือข้ามการเปิด-ปิด โดยไม่ต้องมีโค้ดล้าง state
 */
function AccountMenu({
  user,
  panelId,
}: {
  user: AuthUser;
  panelId: string;
}) {
  const { signOut } = useAuth();
  const [view, setView] = useState<"menu" | "password">("menu");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // โฟกัสเข้าแผงก่อน เพื่อให้โปรแกรมอ่านหน้าจออ่านข้อมูลบัญชีแล้วค่อยให้ Tab ต่อ
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const change = (event: FormEvent) => {
    event.preventDefault();

    if (busy || newPassword !== confirmPassword) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    void changePassword(currentPassword, newPassword)
      .then(() => {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setNotice("เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นถูกออกจากระบบทั้งหมด");
      })
      .catch((failure: unknown) => {
        setError(
          failure instanceof ApiError
            ? failure
            : new ApiError("เปลี่ยนรหัสผ่านไม่สำเร็จ", "UNKNOWN"),
        );
      })
      .finally(() => {
        setBusy(false);
      });
  };

  /**
   * ออกจากระบบต้องกดสองครั้ง
   *
   * ปุ่มนี้อยู่ใกล้ปุ่มอื่นในเมนูที่ปิดได้ง่าย การกดพลาดครั้งเดียวคือหลุดจากเครื่อง
   * ที่ใช้ทำบิลกลางเดือน แล้วต้องพิมพ์รหัสยาวอย่างน้อย 12 ตัวใหม่
   */
  const leave = () => {
    if (signingOut) {
      return;
    }

    if (!confirmingSignOut) {
      setConfirmingSignOut(true);
      return;
    }

    setSigningOut(true);
    setError(null);

    void signOut()
      .catch((failure: unknown) => {
        setError(
          failure instanceof ApiError
            ? failure
            : new ApiError("ออกจากระบบไม่สำเร็จ", "UNKNOWN"),
        );
        setSigningOut(false);
      });
  };

  const formNotice = error !== null && error.field === undefined ? error : null;

  return (
    <div
      id={panelId}
      ref={panelRef}
      tabIndex={-1}
      aria-label="บัญชีของฉัน"
      className="absolute right-0 top-[calc(100%+6px)] z-40 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-ash bg-canvas-white shadow-sm outline-none"
    >
      {view === "menu" ? (
        <>
          <div className="border-b border-ash px-4 py-3">
            <p className="truncate text-[13px] font-semibold text-charcoal">
              {user.displayName}
            </p>
            <p className="num mt-0.5 truncate text-[11px] text-fog">{user.email}</p>
            <div className="mt-2">
              <RoleBadge role={user.role} />
            </div>
          </div>

          <div className="p-1.5">
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] text-charcoal transition-colors hover:bg-paper-mist"
              onClick={() => {
                setConfirmingSignOut(false);
                setView("password");
              }}
            >
              <span className="ms text-[18px] text-slate" aria-hidden="true">
                password
              </span>
              เปลี่ยนรหัสผ่าน
            </button>
            <button
              type="button"
              disabled={signingOut}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] text-danger transition-colors hover:bg-danger-soft disabled:opacity-60"
              onClick={leave}
            >
              <span className="ms text-[18px]" aria-hidden="true">
                logout
              </span>
              {signingOut
                ? "กำลังออกจากระบบ"
                : confirmingSignOut
                  ? "กดอีกครั้งเพื่อออกจากระบบ"
                  : "ออกจากระบบ"}
            </button>
          </div>

          {formNotice !== null && (
            <p className="border-t border-ash px-4 py-3 text-xs text-danger" role="alert">
              {formNotice.message}
            </p>
          )}
          {notice !== null && (
            <p className="border-t border-ash px-4 py-3 text-xs text-status-paid-fg" role="status">
              {notice}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 border-b border-ash py-1.5 pl-1.5 pr-3">
            <button
              type="button"
              aria-label="ย้อนกลับ"
              className="icon-btn h-9 w-9"
              onClick={() => {
                setView("menu");
              }}
            >
              <span className="ms text-[20px]" aria-hidden="true">
                arrow_back
              </span>
            </button>
            <p className="text-[13px] font-semibold text-charcoal">เปลี่ยนรหัสผ่าน</p>
          </div>

          <form className="grid gap-3.5 p-4" onSubmit={change} noValidate>
            <p className="text-xs text-fog">
              เปลี่ยนแล้วอุปกรณ์อื่นที่ค้างอยู่จะถูกออกจากระบบทันที
            </p>
            <PasswordField
              label="รหัสผ่านเดิม"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
              name="currentPassword"
              error={
                error !== null && error.field === "currentPassword"
                  ? error.message
                  : undefined
              }
            />
            <PasswordField
              label="รหัสผ่านใหม่"
              value={newPassword}
              onChange={setNewPassword}
              helper="อย่างน้อย 12 ตัวอักษร"
              autoComplete="new-password"
              name="newPassword"
              error={
                error !== null && error.field === "newPassword"
                  ? error.message
                  : undefined
              }
            />
            <PasswordField
              label="ยืนยันรหัสผ่านใหม่"
              value={confirmPassword}
              onChange={setConfirmPassword}
              matches={newPassword}
              autoComplete="new-password"
              name="confirmPassword"
            />
            {/*
              ข้อความใต้ช่องไม่ใช่ live region — โปรแกรมอ่านหน้าจอจึงไม่ได้ยินว่า
              เปลี่ยนรหัสผ่านไม่สำเร็จ เพราะโฟกัสยังอยู่ที่ปุ่มส่ง ไม่ได้กลับไปที่ช่อง
            */}
            {error !== null && error.field !== undefined && (
              <p className="sr-only" role="alert">
                {error.message}
              </p>
            )}
            {formNotice !== null && (
              <p className="text-xs text-danger" role="alert">
                {formNotice.message}
              </p>
            )}
            {notice !== null && (
              <p className="text-xs text-status-paid-fg" role="status">
                {notice}
              </p>
            )}
            <Button
              variant="secondary"
              type="submit"
              icon="password"
              className="justify-center"
              disabled={
                busy ||
                currentPassword === "" ||
                newPassword === "" ||
                newPassword !== confirmPassword
              }
            >
              {busy ? "กำลังเปลี่ยนรหัสผ่าน" : "เปลี่ยนรหัสผ่าน"}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}

export interface AccountButtonProps {
  /** full = ปุ่มมีชื่อบนแถบบนจอใหญ่ · icon = ปุ่มไอคอนจอเล็ก */
  variant: "full" | "icon";
}

export function AccountButton({ variant }: AccountButtonProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  /**
   * ปิดเมื่อคลิกที่อื่นหรือกด Esc
   *
   * เช็คจาก wrapper ไม่ใช่จากแผง เพราะปุ่มเปิดก็ต้องไม่นับเป็น "ที่อื่น"
   * ไม่งั้น pointerdown จะปิดแผงก่อน แล้ว click ของปุ่มจะเปิดมันกลับมาทันที
   */
  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (wrapperRef.current?.contains(event.target as Node)) {
        return;
      }

      setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (user === null) {
    return null;
  }

  const initial = user.displayName.slice(0, 1);

  return (
    <div
      className="relative"
      ref={wrapperRef}
      /**
       * ปิดเมื่อโฟกัสออกจากทั้งปุ่มและแผง
       *
       * ถ้าไม่ปิด การกด Tab ผ่านแผงไปจนสุดจะทิ้งแผงลอยค้างไว้กลางจอ
       * โดยไม่มีอะไรบอกว่าตอนนี้โฟกัสอยู่ไหน
       */
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) {
          return;
        }

        setOpen(false);
      }}
    >
      {variant === "full" ? (
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => {
            setOpen((previous) => !previous);
          }}
          className="flex min-h-11 items-center gap-2.5 rounded-lg px-1.5 text-left transition-colors hover:bg-paper-mist"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper-mist text-[13px] font-semibold text-charcoal">
            {initial}
          </span>
          <span className="hidden lg:block">
            <span className="block text-[13px] font-semibold text-charcoal">
              {user.displayName}
            </span>
            <span className="block text-[11px] text-fog">
              {user.role === "owner" ? "เจ้าของหอ" : "สมาชิก"}
            </span>
          </span>
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          aria-label="บัญชีของฉัน"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => {
            setOpen((previous) => !previous);
          }}
          className="icon-btn h-11 w-11"
        >
          <span className="ms text-[20px]" aria-hidden="true">
            account_circle
          </span>
        </button>
      )}
      {open && <AccountMenu user={user} panelId={panelId} />}
    </div>
  );
}
