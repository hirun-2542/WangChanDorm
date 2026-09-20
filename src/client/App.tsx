import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AccountButton } from "./account";
import { fetchRooms, fetchSlips, fetchTenants, reviewQueueChangedEvent, type Room, type Tenant } from "./api";
import { ErrorBoundary } from "./error-boundary";
import { BillsPage } from "./pages/bills";
import { DashboardPage } from "./pages/dashboard";
import { FamilyPage } from "./pages/family";
import { LinePage } from "./pages/line";
import { ReviewPage } from "./pages/review";
import { RoomsPage } from "./pages/rooms";
import { SettingsPage } from "./pages/settings";
import { TenantsPage } from "./pages/tenants";
import { SearchProvider, useSearch } from "./search";
import { Monogram, type PageProps } from "./ui";

const routeList = [
  { id: "dashboard", label: "แดชบอร์ด", icon: "space_dashboard" },
  { id: "rooms", label: "ห้องพัก", icon: "door_front" },
  { id: "tenants", label: "ผู้เช่า", icon: "group" },
  { id: "bills", label: "บิล", icon: "receipt_long" },
  { id: "review", label: "รอตรวจ", icon: "fact_check" },
  { id: "line", label: "ข้อความ LINE", icon: "chat_bubble" },
  { id: "family", label: "ครอบครัว", icon: "groups" },
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
  family: FamilyPage,
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
  { route: "family", label: "ครอบครัว", icon: "groups" },
  { route: "settings", label: "ตั้งค่า", icon: "settings" },
] as const;

const moreRoutes: RouteId[] = ["review", "line", "family", "settings"];

interface ParsedRoute {
  route: RouteId;
  view: string;
}

function findRoute(id: RouteId) {
  return routeList.find((item) => item.id === id) ?? routeList[0];
}

function parseRoute(hash: string): ParsedRoute {
  const [pathPart = ""] = hash.replace(/^#/, "").split("?");
  const [routePart = "", viewPart = ""] = pathPart.split("/");
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

const desktopSearchQuery = "(min-width: 768px)";

function useDesktopSearch(): boolean {
  const [available, setAvailable] = useState<boolean>(() =>
    typeof window === "undefined" ? true : window.matchMedia(desktopSearchQuery).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(desktopSearchQuery);
    const update = () => {
      setAvailable(media.matches);
    };

    media.addEventListener("change", update);

    return () => {
      media.removeEventListener("change", update);
    };
  }, []);

  return available;
}

function searchOptionId(index: number): string {
  return `topbar-search-option-${index}`;
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
  const desktopSearch = useDesktopSearch();
  const searchRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLDialogElement>(null);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [jumpRooms, setJumpRooms] = useState<Room[]>([]);
  const [jumpTenants, setJumpTenants] = useState<Tenant[]>([]);
  const [panelDismissed, setPanelDismissed] = useState(false);
  const [activeResult, setActiveResult] = useState(0);

  /**
   * ดัชนีสำหรับค้นหาด่วน — โหลดซ้ำทุกครั้งที่โฟกัสช่องค้นหา
   * เพราะห้องและผู้เช่าแก้ได้จากหน้าอื่นโดยไม่เปลี่ยนเส้นทาง
   */
  const loadJumpIndex = useCallback(() => {
    void Promise.all([fetchRooms(), fetchTenants()])
      .then(([rooms, tenants]) => {
        setJumpRooms(rooms);
        setJumpTenants(tenants);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadJumpIndex();
  }, [loadJumpIndex]);

  useEffect(() => {
    let active = true;

    const refreshCount = () => {
      void fetchSlips()
        .then((slips) => {
          if (active) {
            setPendingReviewCount(slips.length);
          }
        })
        .catch(() => undefined);
    };

    refreshCount();
    window.addEventListener(reviewQueueChangedEvent, refreshCount);

    return () => {
      active = false;
      window.removeEventListener(reviewQueueChangedEvent, refreshCount);
    };
  }, [parsed.route]);

  useEffect(() => {
    if (!desktopSearch) {
      return;
    }

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
  }, [desktopSearch]);

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
  const moreActive = moreRoutes.includes(parsed.route);

  const needle = query.trim().toLowerCase();
  const jumpResults =
    needle === ""
      ? []
      : [
          ...jumpRooms
            .filter((room) => room.roomNumber.toLowerCase().includes(needle))
            .slice(0, 4)
            .map((room) => ({
              key: `room-${room.id}`,
              label: `ห้อง ${room.roomNumber}`,
              detail: room.occupiedBy ?? "ห้องว่าง",
              kind: "ห้องพัก",
              hash: "#rooms",
            })),
          ...jumpTenants
            .filter(
              (tenant) =>
                tenant.fullName.toLowerCase().includes(needle) ||
                tenant.roomNumber.toLowerCase().includes(needle) ||
                tenant.phone.includes(needle),
            )
            .slice(0, 4)
            .map((tenant) => ({
              key: `tenant-${tenant.id}`,
              label: tenant.fullName,
              detail: `ห้อง ${tenant.roomNumber}`,
              kind: "ผู้เช่า",
              hash: "#tenants",
            })),
        ].slice(0, 6);
  const searchPanelOpen = needle !== "" && !panelDismissed;
  const activeIndex = jumpResults.length === 0 ? -1 : Math.min(activeResult, jumpResults.length - 1);

  const openResult = (hash: string) => {
    setQuery("");
    setPanelDismissed(true);
    window.location.hash = hash;
  };

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
              role="combobox"
              aria-expanded={searchPanelOpen}
              aria-controls="topbar-search-results"
              aria-autocomplete="list"
              aria-activedescendant={searchPanelOpen && activeIndex >= 0 ? searchOptionId(activeIndex) : undefined}
              className="input h-11 pl-10 pr-20"
              placeholder="ค้นหาห้อง, ผู้เช่า, เบอร์โทร..."
              aria-label="ค้นหาห้อง, ผู้เช่า, เบอร์โทร"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPanelDismissed(false);
                setActiveResult(0);
              }}
              onFocus={loadJumpIndex}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  if (searchPanelOpen) {
                    event.preventDefault();
                    setPanelDismissed(true);
                  }

                  return;
                }

                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  if (jumpResults.length === 0) {
                    return;
                  }

                  event.preventDefault();

                  if (!searchPanelOpen) {
                    setPanelDismissed(false);
                    setActiveResult(event.key === "ArrowDown" ? 0 : jumpResults.length - 1);
                    return;
                  }

                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setActiveResult((activeIndex + step + jumpResults.length) % jumpResults.length);
                  return;
                }

                if (event.key === "Enter" && searchPanelOpen) {
                  const choice = jumpResults[activeIndex];

                  if (choice !== undefined) {
                    event.preventDefault();
                    openResult(choice.hash);
                  }
                }
              }}
            />
            {desktopSearch && (
              <span className="kbd pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">Ctrl K</span>
            )}

            {searchPanelOpen && (
              <div
                id="topbar-search-results"
                className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-xl border border-ash bg-canvas-white py-1 shadow-sm"
              >
                {jumpResults.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-steel">ไม่พบห้องหรือผู้เช่าที่ตรงกับคำค้น</p>
                ) : (
                  <div role="listbox" aria-label="ผลการค้นหาห้องและผู้เช่า">
                    {jumpResults.map((result, index) => (
                      <button
                        key={result.key}
                        id={searchOptionId(index)}
                        type="button"
                        role="option"
                        tabIndex={-1}
                        aria-selected={index === activeIndex}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${
                          index === activeIndex ? "bg-paper-mist" : "hover:bg-paper-mist"
                        }`}
                        onMouseEnter={() => {
                          setActiveResult(index);
                        }}
                        onClick={() => {
                          openResult(result.hash);
                        }}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-charcoal">{result.label}</span>
                          <span className="num block truncate text-xs text-fog">{result.detail}</span>
                        </span>
                        <span className="chip shrink-0">{result.kind}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <PendingLink className="icon-btn" badge={pendingReviewCount} label="รอตรวจสลิป" />
            <AccountButton variant="full" />
          </div>
        </header>

        <header className="sticky top-0 z-30 flex h-14 items-center gap-2.5 border-b border-ash bg-canvas-white px-4 md:hidden">
          <Monogram />
          <PendingLink className="icon-btn ml-auto h-11 w-11" badge={pendingReviewCount} label="รอตรวจสลิป" />
          <AccountButton variant="icon" />
        </header>

        <main className="mx-auto w-full max-w-[1400px] px-4 pb-28 pt-5 md:px-6 md:pb-12 md:pt-6">
          <ErrorBoundary resetKey={`${parsed.route}/${parsed.view}`}>
            <Page view={parsed.view} />
          </ErrorBoundary>
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
