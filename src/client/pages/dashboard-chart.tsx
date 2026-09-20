import { baht } from "./bills-shared";

export interface MonthlyRevenue {
  month: string;
  amount: number;
}

export interface RevenueChartProps {
  points: MonthlyRevenue[];
  highlight: string;
  label: string;
}

// The tallest bar stops short of the top so its own value label has room above it.
const MAX_BAR_PERCENT = 88;
const MIN_BAR_PERCENT = 3;
const ABSENT_MARK = "—";

export function RevenueChart({ points, highlight, label }: RevenueChartProps) {
  const peak = points.reduce((max, point) => (point.amount > max ? point.amount : max), 0);
  const scale = peak === 0 ? 1 : peak;

  return (
    <div>
      <div className="flex h-40 gap-1.5 sm:gap-2" role="img" aria-label={label}>
        {points.map((point) => {
          const active = point.month === highlight;
          const present = point.amount > 0;
          const percent = present ? Math.max((point.amount / scale) * MAX_BAR_PERCENT, MIN_BAR_PERCENT) : 0;

          return (
            <div key={point.month} className="relative flex h-full min-w-0 flex-1 flex-col justify-end">
              <span
                className={`num absolute inset-x-0 text-center text-[10px] leading-none sm:text-[11px] ${
                  present ? "text-charcoal" : "text-fog"
                }`}
                style={{ bottom: `calc(${percent}% + 4px)` }}
              >
                {present ? baht(point.amount) : ABSENT_MARK}
              </span>
              <div
                className={`w-full rounded-t-md ${active ? "bg-electric-blue" : "bg-status-unpaid-bg"}`}
                style={{ height: `${percent}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5 sm:gap-2">
        {points.map((point) => (
          <div
            key={point.month}
            className={`min-w-0 flex-1 text-center text-[11px] ${
              point.month === highlight ? "font-medium text-charcoal" : "text-steel"
            }`}
          >
            {point.month}
          </div>
        ))}
      </div>
    </div>
  );
}
