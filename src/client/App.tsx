import { useEffect, useRef, useState, type ReactNode } from "react";
import { pendingReviewCount } from "./mock-data";
import { BillsPage } from "./pages/bills";
import { DashboardPage } from "./pages/dashboard";
import { LinePage } from "./pages/line";
import { ReviewPage } from "./pages/review";
import { RoomsPage } from "./pages/rooms";
import { SettingsPage } from "./pages/settings";
import { TenantsPage } from "./pages/tenants";
import { SearchProvider, useSearch } from "./search";
import type { PageProps } from "./ui";

const routeList = [
  { id: "dashboard", label: "แดชบอร์ด", icon: "space_dashboard" },
  { id: "rooms", label: "ห้องพัก", icon: "door_front" },
  { id: "tenants", label: "ผู้เช่า", icon: "group" },
  { id: "bills", label: "บิล", icon: "receipt_long" },
  { id: "review", label: "รอตรวจ", icon: "fact_check" },
  { id: "line", label: "ข้อความ LINE", icon: "chat_bubble" },
  { id: "settings", label: "ตั้งค่า", icon: "settings" },
] as const;

type RouteId = (typeof routeList)[number]["id"];

const pages: Record<RouteId, (props: PageProps) => ReactNode> = {
  dashboard: DashboardPage,
  rooms: RoomsPage,
  tenants: TenantsPage,
  bills: BillsPage,
  review: ReviewPage,
  line: LinePage,
  settings: SettingsPage,
};

const mobileTabs = [
  { id: "dashboard", label: "แดชบอร์ด", icon: "space_dashboard" },
  { id: "rooms", label: "ห้องพัก", icon: "door_front" },
  { id: "tenants", label: "ผู้เช่า", icon: "group" },
  { id: "bills", label: "บิล", icon: "receipt_long" },
] as const;

const moreItems = [
  { route: "review", label: "รอตรวจ", icon: "fact_check" },
  { route: "line", label: "ข้อความ LINE", icon: "chat_bubble" },
  { route: "settings", label: "ตั้งค่า", icon: "settings" },
] as const;

const moreRoutes: RouteId[] = ["review", "line", "settings"];

interface ParsedRoute {
  route: RouteId;
  view: string;
}

function findRoute(id: RouteId) {
  return routeList.find((item) => item.id === id) ?? routeList[0];
}

function parseRoute(hash: string): ParsedRoute {
  const [routePart = "", viewPart = ""] = hash.replace(/^#/, "").split("/");
  const match = routeList.find((item) => item.id === routePart);

  if (match === undefined) {
    return { route: "dashboard", view: "" };
  }

  return { route: match.id, view: viewPart };
}

function routeTitle(parsed: ParsedRoute) {
  if (parsed.route === "bills" && parsed.view === "create") {
    return "สร้างบิล";
  }

  return findRoute(parsed.route).label;
}

function useHashRoute(): ParsedRoute {
  const [parsed, setParsed] = useState<ParsedRoute>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onHashChange = () => {
      setParsed(parseRoute(window.location.hash));
    };

    window.addEventListener("hashchange", onHashChange);

    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  useEffect(() => {
    document.title = `${routeTitle(parsed)} — หอพักวังจันทร์`;
    window.scrollTo(0, 0);
  }, [parsed]);

  return parsed;
}

function Monogram() {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[image:var(--gradient-conic-spectrum)] p-[2px]">
      <span className="grid h-full w-full place-items-center rounded-xl bg-canvas-white text-[13px] font-semibold text-charcoal">วจ</span>
    </span>
  );
}

interface NavLinkProps {
  route: RouteId;
  label: string;
  icon: string;
  active: boolean;
  badge?: number;
}

function NavLink({ route, label, icon, active, badge }: NavLinkProps) {
  return (
    <a
      href={`#${route}`}
      title={label}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm no-underline transition-colors md:justify-center xl:justify-start ${
        active ? "bg-status-unpaid-bg text-deep-sapphire" : "text-graphite hover:bg-paper-mist hover:text-charcoal"
      }`}
    >
      <span className={active ? "ms fill text-[18px]" : "ms text-[18px]"} aria-hidden="true">
        {icon}
      </span>
      <span className="hidden xl:inline">{label}</span>
      {badge !== undefined && badge > 0 && (
        <>
          <span className="absolute right-3 top-2 h-2 w-2 rounded-full bg-tangerine md:block xl:hidden" aria-hidden="true" />
          <span className="num ml-auto hidden rounded-full bg-status-review-bg px-2 py-0.5 text-[11px] font-medium text-status-review-fg xl:inline">
            {badge}
          </span>
        </>
      )}
    </a>
  );
}

function PendingLink({ className, badge, label }: { className: string; badge: number; label: string }) {
  return (
    <a href="#review" aria-label={label} className={className}>
      <span className="ms text-[20px]" aria-hidden="true">
        fact_check
      </span>
      {badge > 0 && (
        <span className="num absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-status-review-bg px-1 text-[11px] font-medium text-status-review-fg">
          {badge}
        </span>
      )}
    </a>
  );
}

function Shell() {
  const parsed = useHashRoute();
  const { query, setQuery } = useSearch();
  const searchRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    setQuery("");
  }, [parsed.route, setQuery]);

  const closeMore = () => {
    moreRef.current?.close();
  };

  const openMore = () => {
    moreRef.current?.showModal();
  };

  const Page = pages[parsed.route];
  const title = routeTitle(parsed);
  const moreActive = moreRoutes.includes(parsed.route);

  return (
    <div className="min-h-screen bg-canvas-white text-charcoal md:grid md:grid-cols-[72px_1fr] xl:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col overflow-y-auto border-r border-ash bg-canvas-white px-3 py-4 md:flex">
        <div className="flex items-center gap-2.5 px-1 pb-5 md:justify-center md:px-0 xl:justify-start xl:px-1">
          <Monogram />
          <span className="hidden xl:block">
            <span className="block text-sm font-semibold text-charcoal">หอพักวังจันทร์</span>
            <span className="block text-[11px] text-fog">ระบบจัดการหอพัก</span>
          </span>
        </div>

        <nav className="grid gap-1" aria-label="เมนูหลัก">
          {routeList.map((item) => (
            <div key={item.id}>
              <NavLink
                route={item.id}
                label={item.label}
                icon={item.icon}
                active={item.id === parsed.route}
                badge={item.id === "review" ? pendingReviewCount : undefined}
              />
              {item.id === "bills" && parsed.route === "bills" && (
                <div className="mt-1 hidden gap-1 pl-6 xl:grid">
                  <a
                    href="#bills/create"
                    aria-current={parsed.view === "create" ? "page" : undefined}
                    className={`flex min-h-9 items-center rounded-lg px-2.5 text-[13px] no-underline transition-colors ${
                      parsed.view === "create" ? "bg-status-unpaid-bg font-medium text-deep-sapphire" : "text-steel hover:bg-paper-mist"
                    }`}
                  >
                    สร้างบิล
                  </a>
                  <a
                    href="#bills"
                    aria-current={parsed.view === "" ? "page" : undefined}
                    className={`flex min-h-9 items-center rounded-lg px-2.5 text-[13px] no-underline transition-colors ${
                      parsed.view === "" ? "bg-status-unpaid-bg font-medium text-deep-sapphire" : "text-steel hover:bg-paper-mist"
                    }`}
                  >
                    รายการบิล
                  </a>
                </div>
              )}
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 hidden h-16 items-center gap-4 border-b border-ash bg-canvas-white px-6 md:flex">
          <div className="relative w-full max-w-[480px]">
            <span className="ms pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-fog" aria-hidden="true">
              search
            </span>
            <input
              ref={searchRef}
              type="search"
              className="input h-11 pl-10 pr-20"
              placeholder="ค้นหาห้อง, ผู้เช่า, เบอร์โทร..."
              aria-label="ค้นหาห้อง, ผู้เช่า, เบอร์โทร"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
            <span className="kbd pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">Ctrl K</span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <PendingLink className="icon-btn" badge={pendingReviewCount} label="รอตรวจสลิป" />
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-paper-mist text-[13px] font-semibold text-charcoal">จ</span>
              <span className="hidden lg:block">
                <span className="block text-[13px] font-semibold text-charcoal">เจ้าของหอพัก</span>
                <span className="block text-[11px] text-fog">ผู้ดูแลระบบ</span>
              </span>
            </div>
          </div>
        </header>

        <header className="sticky top-0 z-30 flex h-14 items-center gap-2.5 border-b border-ash bg-canvas-white px-4 md:hidden">
          <Monogram />
          <strong className="truncate text-sm font-semibold text-charcoal">{title}</strong>
          <PendingLink className="icon-btn ml-auto h-11 w-11" badge={pendingReviewCount} label="รอตรวจสลิป" />
        </header>

        <main className="mx-auto w-full max-w-[1400px] px-4 pb-28 pt-5 md:px-6 md:pb-12 md:pt-6">
          <div className="mb-3">
            <span className="chip">ข้อมูลตัวอย่าง</span>
          </div>
          <Page view={parsed.view} />
        </main>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-ash bg-canvas-white md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="เมนูหลัก"
      >
        {mobileTabs.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={item.id === parsed.route ? "page" : undefined}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] no-underline ${
              item.id === parsed.route ? "text-deep-sapphire" : "text-fog"
            }`}
          >
            <span className={item.id === parsed.route ? "ms fill text-[22px]" : "ms text-[22px]"} aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </a>
        ))}
        <button
          type="button"
          onClick={openMore}
          aria-current={moreActive ? "page" : undefined}
          className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] ${moreActive ? "text-deep-sapphire" : "text-fog"}`}
        >
          <span className={moreActive ? "ms fill text-[22px]" : "ms text-[22px]"} aria-hidden="true">
            more_horiz
          </span>
          เพิ่มเติม
        </button>
      </nav>

      <dialog
        ref={moreRef}
        className="sheet"
        aria-label="เมนูเพิ่มเติม"
        onCancel={(event) => {
          event.preventDefault();
          closeMore();
        }}
        onClick={(event) => {
          if (event.target === moreRef.current) {
            closeMore();
          }
        }}
      >
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-smoke" aria-hidden="true" />
        <nav className="grid gap-1 px-4 pb-4 pt-3" aria-label="เมนูเพิ่มเติม">
          {moreItems.map((item) => (
            <a
              key={item.route}
              href={`#${item.route}`}
              onClick={closeMore}
              aria-current={item.route === parsed.route ? "page" : undefined}
              className={`flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm no-underline ${
                item.route === parsed.route ? "bg-status-unpaid-bg text-deep-sapphire" : "text-charcoal hover:bg-paper-mist"
              }`}
            >
              <span className="ms text-[20px]" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
              {item.route === "review" && pendingReviewCount > 0 && (
                <span className="num ml-auto rounded-full bg-status-review-bg px-2 py-0.5 text-[11px] font-medium text-status-review-fg">
                  {pendingReviewCount}
                </span>
              )}
            </a>
          ))}
        </nav>
      </dialog>
    </div>
  );
}

export default function App() {
  return (
    <SearchProvider>
      <Shell />
    </SearchProvider>
  );
}
