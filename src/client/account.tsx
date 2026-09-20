import { useEffect, useId, useRef, useState, type FocusEvent } from "react";
import { ApiError, type AuthUser } from "./api";
import { useAuth } from "./auth";
import { RoleBadge } from "./ui";

/**
 * เมนูบัญชีที่เปิดจากชื่อผู้ใช้บนแถบบน
 *
 * เดิมเป็นโมดัลกลางจอ ทั้งที่คำถามที่คนกดเข้ามาหามีสองข้อ — "ตอนนี้ฉันเข้าใช้ด้วย
 * บัญชีอะไร" กับ "ออกจากระบบ" — จึงย่อลงเป็นเมนูที่ตอบสองข้อนั้นตรง ๆ
 *
 * ไม่มีที่เปลี่ยนรหัสผ่านแล้วโดยตั้งใจ: เจ้าของใช้ Google เป็นทั้งทางเข้าและทางกู้
 * การเปลี่ยนรหัสผ่านต้องกรอกรหัสเดิม ซึ่งเป็นสิ่งที่คนที่เข้าด้วย Google ไม่มี
 * และการมีปุ่มที่กดแล้วไปต่อไม่ได้ worse กว่าไม่มีปุ่ม
 *
 * แผงนี้ถูกสร้างใหม่ทุกครั้งที่เปิด (unmount ตอนปิด) ข้อความ error ที่ค้างอยู่
 * จึงไม่หลงเหลือข้ามการเปิด-ปิด โดยไม่ต้องมีโค้ดล้าง state
 */
function AccountMenu({ user, panelId }: { user: AuthUser; panelId: string }) {
  const { signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // โฟกัสเข้าแผงก่อน เพื่อให้โปรแกรมอ่านหน้าจออ่านข้อมูลบัญชีแล้วค่อยให้ Tab ต่อ
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  /**
   * ออกจากระบบต้องกดสองครั้ง
   *
   * ปุ่มนี้อยู่ในเมนูที่กดพลาดได้ง่าย การกดพลาดครั้งเดียวคือหลุดจากเครื่องที่ใช้
   * ทำบิลกลางเดือน แล้วต้องเข้าสู่ระบบใหม่กลางงาน
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

  return (
    <div
      id={panelId}
      ref={panelRef}
      tabIndex={-1}
      aria-label="บัญชีของฉัน"
      className="absolute right-0 top-[calc(100%+6px)] z-40 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-ash bg-canvas-white shadow-sm outline-none"
    >
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

      {error !== null && (
        <p className="border-t border-ash px-4 py-3 text-xs text-danger" role="alert">
          {error.message}
        </p>
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

  /**
   * ปิดเมื่อโฟกัสออกจากทั้งปุ่มและแผง
   *
   * ถ้าไม่ปิด การกด Tab ผ่านแผงไปจนสุดจะทิ้งแผงลอยค้างไว้กลางจอ
   * โดยไม่มีอะไรบอกว่าตอนนี้โฟกัสอยู่ไหน
   */
  const closeWhenFocusLeaves = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    setOpen(false);
  };

  return (
    <div className="relative" ref={wrapperRef} onBlur={closeWhenFocusLeaves}>
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
