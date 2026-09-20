import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { fetchMe, logout, onUnauthorized, type AuthUser } from "./api";
import { AuthScreen, AuthSplash, InviteAcceptScreen } from "./pages/auth";

export interface AuthValue {
  /** null = ยังไม่เข้าสู่ระบบ */
  user: AuthUser | null;
  /** กำลังตรวจเซสชันครั้งแรกก่อนตัดสินใจว่าจะแสดงหน้าใด */
  checking: boolean;
  /** ออกจากระบบที่เซิร์ฟเวอร์แล้วพากลับหน้าเข้าสู่ระบบ */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);

  /**
   * ตรวจเซสชันจากคุกกี้
   *
   * ไม่มี "ตั้งผู้ใช้หลังเข้าสู่ระบบ" ให้เรียกแล้ว เพราะการเข้าสู่ระบบด้วย Google
   * ออกจากหน้าไปที่ Google แล้วกลับมาที่ / ทั้งหน้า โหลดครั้งถัดไปจึงเรียกตัวนี้
   * เองและได้เซสชันที่เซิร์ฟเวอร์เพิ่งสร้างให้
   */
  const load = useCallback(async () => {
    try {
      setUser(await fetchMe());
    } catch {
      // 401 คือยังไม่เข้าสู่ระบบ ส่วนเน็ตหรือเซิร์ฟเวอร์ล่มก็ให้หน้าเข้าสู่ระบบไว้ก่อน
      setUser(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // เซสชันหมดอายุระหว่างใช้งาน 401 จากคำขอใด ๆ จึงพากลับหน้าเข้าสู่ระบบทันที
  useEffect(() => onUnauthorized(() => setUser(null)), []);

  const signOut = useCallback(async () => {
    await logout();
    setUser(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      checking,
      signOut,
    }),
    [user, checking, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);

  if (value === null) {
    throw new Error("useAuth ต้องเรียกภายใน AuthProvider");
  }

  return value;
}

const inviteHashPrefix = "#invite/";

function inviteTokenOf(hash: string): string | null {
  if (!hash.startsWith(inviteHashPrefix)) {
    return null;
  }

  const token = (hash.slice(inviteHashPrefix.length).split("?")[0] ?? "").trim();

  return token === "" ? null : token;
}

function useInviteToken(): string | null {
  const [token, setToken] = useState<string | null>(() =>
    inviteTokenOf(window.location.hash),
  );

  useEffect(() => {
    const update = () => {
      setToken(inviteTokenOf(window.location.hash));
    };

    window.addEventListener("hashchange", update);

    return () => {
      window.removeEventListener("hashchange", update);
    };
  }, []);

  return token;
}

/** ด่านเดียวที่ตัดสินว่าใครเห็นอะไร: คำเชิญ · กำลังตรวจเซสชัน · เข้าสู่ระบบ · ตัวแอป */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, checking } = useAuth();
  const inviteToken = useInviteToken();

  if (inviteToken !== null) {
    return (
      <InviteAcceptScreen
        // คำเชิญคนละใบต้องเริ่มจากสถานะของตัวเอง ไม่ค้างข้อมูลใบก่อนไว้
        key={inviteToken}
        token={inviteToken}
        onLeave={() => {
          window.location.hash = user === null ? "" : "#dashboard";
        }}
      />
    );
  }

  if (checking) {
    return <AuthSplash />;
  }

  if (user === null) {
    return <AuthScreen />;
  }

  return <>{children}</>;
}
