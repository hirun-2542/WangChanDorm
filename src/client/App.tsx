import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import {
  BillsPage,
  DashboardPage,
  LinePage,
  ReviewPage,
  RoomsPage,
  SettingsPage,
  TenantsPage,
} from "./pages";

const routes = ["dashboard", "rooms", "tenants", "bills", "review", "line", "settings"] as const;

type Route = (typeof routes)[number];

interface RouteMeta {
  navLabel: string;
  tabLabel: string;
  pageTitle: string;
  icon: string;
  Page: ComponentType;
}

const routeMeta: Record<Route, RouteMeta> = {
  dashboard: {
    navLabel: "แดชบอร์ด",
    tabLabel: "Dashboard",
    pageTitle: "Dashboard",
    icon: "space_dashboard",
    Page: DashboardPage,
  },
  rooms: {
    navLabel: "ห้องพัก",
    tabLabel: "ห้อง",
    pageTitle: "ห้องพัก",
    icon: "door_front",
    Page: RoomsPage,
  },
  tenants: {
    navLabel: "ผู้เช่า",
    tabLabel: "ผู้เช่า",
    pageTitle: "ผู้เช่า",
    icon: "group",
    Page: TenantsPage,
  },
  bills: {
    navLabel: "บิล",
    tabLabel: "บิล",
    pageTitle: "บิล",
    icon: "receipt_long",
    Page: BillsPage,
  },
  review: {
    navLabel: "รอตรวจ",
    tabLabel: "รอตรวจ",
    pageTitle: "รอตรวจสลิป",
    icon: "fact_check",
    Page: ReviewPage,
  },
  line: {
    navLabel: "ข้อความ LINE",
    tabLabel: "LINE",
    pageTitle: "ข้อความ LINE",
    icon: "chat_bubble",
    Page: LinePage,
  },
  settings: {
    navLabel: "ตั้งค่า",
    tabLabel: "ตั้งค่า",
    pageTitle: "ตั้งค่า",
    icon: "settings",
    Page: SettingsPage,
  },
};

const desktopRoutes: Route[] = ["dashboard", "rooms", "tenants", "bills", "review", "line", "settings"];
const mobileRoutes: Route[] = ["dashboard", "rooms", "tenants", "bills", "review", "settings"];

function parseRoute(hash: string): Route {
  const id = hash.replace(/^#/, "");
  return routes.find((route) => route === id) ?? "dashboard";
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseRoute(window.location.hash));
    };

    window.addEventListener("hashchange", onHashChange);

    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  useEffect(() => {
    document.title = `${routeMeta[route].pageTitle} — หอพักวังจันทร์`;
    window.scrollTo(0, 0);
  }, [route]);

  return route;
}

function logoClasses(size: string): string {
  return `grid ${size} shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#2485ff] to-[#0f63db] text-white`;
}

interface NavItemProps {
  route: Route;
  active: boolean;
}

function SidebarNavItem({ route, active }: NavItemProps) {
  const meta = routeMeta[route];

  return (
    <a
      href={`#${route}`}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-sm font-medium no-underline transition-colors md:justify-center lg:justify-start ${
        active ? "bg-soft text-primary-deep" : "text-muted hover:bg-soft hover:text-primary-deep"
      }`}
    >
      <span className="ms text-[20px]">{meta.icon}</span>
      <span className="hidden lg:inline">{meta.navLabel}</span>
    </a>
  );
}

function MobileTabItem({ route, active }: NavItemProps) {
  const meta = routeMeta[route];

  return (
    <a
      href={`#${route}`}
      aria-current={active ? "page" : undefined}
      className={`flex flex-1 flex-col items-center justify-center gap-1 text-[10px] no-underline ${
        active ? "text-primary-deep" : "text-muted-2"
      }`}
    >
      <span className="ms text-[22px]">{meta.icon}</span>
      {meta.tabLabel}
    </a>
  );
}

export default function App() {
  const route = useHashRoute();
  const Page = routeMeta[route].Page;

  return (
    <div className="min-h-screen bg-bg md:grid md:grid-cols-[88px_1fr] lg:grid-cols-[236px_1fr]">
      <aside className="hidden border-r border-border bg-surface px-2.5 py-[18px] md:sticky md:top-0 md:flex md:h-screen md:flex-col lg:px-3.5">
        <div className="flex items-center gap-2.5 px-2 pb-[18px] md:justify-center md:px-0 lg:justify-start lg:px-2">
          <div className={logoClasses("h-10 w-10")}>
            <span className="ms fill text-[22px]">home</span>
          </div>
          <div className="hidden lg:block">
            <div className="font-bold leading-tight">Wang Chan Dorm</div>
            <div className="text-xs text-muted-2">ระบบจัดการหอพัก</div>
          </div>
        </div>

        <nav className="grid gap-1.5">
          {desktopRoutes.map((item) => (
            <SidebarNavItem key={item} route={item} active={item === route} />
          ))}
        </nav>

        <div className="mt-auto hidden px-2 pb-1 pt-3 text-xs text-muted-2 lg:block">
          Wang Chan Dorm · MVP
          <br />
          Clean Premium Theme
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 hidden h-[66px] items-center gap-4 border-b border-border bg-white/90 px-6 backdrop-blur md:flex">
          <div className="relative max-w-[480px] flex-1">
            <span className="ms pointer-events-none absolute left-3 top-2.5 text-[18px] text-muted-2">search</span>
            <input
              className="h-10 w-full rounded-[10px] border border-border bg-surface-alt pl-9 pr-[68px] text-sm outline-none focus:border-primary"
              placeholder="ค้นหาห้อง, ผู้เช่า, เบอร์โทร..."
              aria-label="ค้นหา"
            />
            <span className="absolute right-2 top-2 rounded-md border border-border bg-[#f2f6fb] px-1.5 py-0.5 text-[11px] text-muted-2">
              Ctrl K
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <button
              type="button"
              className="grid h-[38px] w-[38px] place-items-center rounded-[10px] border border-border bg-surface text-muted"
              aria-label="แจ้งเตือน"
            >
              <span className="ms text-[20px]">notifications</span>
            </button>
            <div className="flex items-center gap-2.5 text-[13px]">
              <div className="grid h-[34px] w-[34px] place-items-center rounded-full bg-gradient-to-br from-[#e9f2ff] to-[#bfd9ff] font-bold text-primary-deep">
                N
              </div>
              <div>
                <div className="font-semibold">เจ้าของหอพัก</div>
                <div className="text-[11px] text-muted-2">ผู้ดูแลระบบ</div>
              </div>
            </div>
          </div>
        </header>

        <header className="sticky top-0 z-30 flex h-[58px] items-center gap-2.5 border-b border-border bg-white/95 px-4 md:hidden">
          <div className={logoClasses("h-9 w-9")}>
            <span className="ms fill text-[20px]">home</span>
          </div>
          <strong>{routeMeta[route].pageTitle}</strong>
          <button
            type="button"
            className="ml-auto grid h-9 w-9 place-items-center rounded-[10px] border border-border bg-surface text-muted"
            aria-label="แจ้งเตือน"
          >
            <span className="ms text-[20px]">notifications</span>
          </button>
        </header>

        <main className="mx-auto max-w-[1480px] px-4 pb-24 pt-5 md:px-6 md:pb-10 md:pt-7">
          <Page />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[68px] border-t border-border bg-surface md:hidden">
        {mobileRoutes.map((item) => (
          <MobileTabItem key={item} route={item} active={item === route} />
        ))}
      </nav>
    </div>
  );
}
