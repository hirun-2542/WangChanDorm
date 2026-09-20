import { useEffect, useState, type FormEvent } from "react";
import { ApiError, changePassword } from "./api";
import { useAuth } from "./auth";
import { Button, Dialog, PasswordField, RoleBadge } from "./ui";

function AccountDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { user, signOut } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * ปิดแล้วเปิดใหม่ต้องเริ่มจากศูนย์
   *
   * ทั้งข้อความ error เก่าและรหัสผ่านที่พิมพ์ค้างไว้ไม่ควรอยู่ต่อ เพราะเครื่องนี้
   * อาจเป็นเครื่องใช้ร่วมกันในบ้าน และการเห็น error ค้างทำให้เข้าใจว่าเพิ่งล้มเหลวอีกครั้ง
   */
  useEffect(() => {
    if (open) {
      return;
    }

    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    setNotice(null);
    setConfirmingSignOut(false);
  }, [open]);

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
   * ปุ่มนี้เคยอยู่แถบล่างติดกับ "ปิด" ห่างกัน 8px ทั้งคู่สูงเท่ากัน พลาดคลิกครั้งเดียว
   * คือหลุดจากเครื่องที่ใช้ทำบิลกลางเดือน แล้วต้องพิมพ์รหัสยาวใหม่
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
      })
      .finally(() => {
        setSigningOut(false);
      });
  };

  const formNotice = error !== null && error.field === undefined ? error : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="บัญชีของฉัน"
      footer={
        <Button variant="ghost" onClick={onClose}>
          ปิด
        </Button>
      }
    >
      {user !== null && (
        <div className="grid gap-4">
          <dl className="grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-steel">ชื่อที่แสดง</dt>
              <dd className="text-charcoal">{user.displayName}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-steel">อีเมล</dt>
              <dd className="num text-charcoal">{user.email}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-steel">สิทธิ์ในครอบครัว</dt>
              <dd>
                <RoleBadge role={user.role} />
              </dd>
            </div>
          </dl>

          <form
            className="grid gap-4 border-t border-ash pt-4"
            onSubmit={change}
            noValidate
          >
            <div>
              <h3 className="text-[15px] text-charcoal">เปลี่ยนรหัสผ่าน</h3>
              <p className="mt-0.5 text-xs text-fog">
                เปลี่ยนแล้วอุปกรณ์อื่นที่ค้างอยู่จะถูกออกจากระบบทันที
              </p>
            </div>
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

          <div className="border-t border-ash pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-fog">
                ออกจากระบบแล้วต้องเข้าสู่ระบบใหม่ด้วยอีเมลและรหัสผ่านเดิม
              </p>
              <Button
                variant="danger-soft"
                icon="logout"
                disabled={signingOut}
                onClick={leave}
              >
                {signingOut
                  ? "กำลังออกจากระบบ"
                  : confirmingSignOut
                    ? "กดอีกครั้งเพื่อออกจากระบบ"
                    : "ออกจากระบบ"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export interface AccountButtonProps {
  /** full = ปุ่มมีชื่อบนแถบบนจอใหญ่ · icon = ปุ่มไอคอนจอเล็ก */
  variant: "full" | "icon";
}

export function AccountButton({ variant }: AccountButtonProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  if (user === null) {
    return null;
  }

  const initial = user.displayName.slice(0, 1);

  return (
    <>
      {variant === "full" ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
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
          type="button"
          aria-label="บัญชีของฉัน"
          onClick={() => {
            setOpen(true);
          }}
          className="icon-btn h-11 w-11"
        >
          <span className="ms text-[20px]" aria-hidden="true">
            account_circle
          </span>
        </button>
      )}
      <AccountDialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}
