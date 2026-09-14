import { useEffect, useState } from "react";
import { type MonthlyRevenue } from "../mock-data";
import { baht } from "./bills-shared";

export interface RevenueChartProps {
  points: MonthlyRevenue[];
  highlight: string;
  label: string;
}

const WIDTH = 640;
const HEIGHT = 220;
const PAD_X = 16;
const PAD_TOP = 34;
const PAD_BOTTOM = 26;
const GAP = 16;
const BAR_RADIUS = 6;

const MOBILE_WIDTH = 320;
const MOBILE_HEIGHT = 180;
const MOBILE_PAD_X = 10;
const MOBILE_PAD_TOP = 30;
const MOBILE_PAD_BOTTOM = 22;
const MOBILE_GAP = 6;
const MOBILE_FONT = 16;

function useIsWideViewport(): boolean {
  const [wide, setWide] = useState<boolean>(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 768px)").matches,
  );

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => {
      setWide(media.matches);
    };

    update();
    media.addEventListener("change", update);

    return () => {
      media.removeEventListener("change", update);
    };
  }, []);

  return wide;
}

export function RevenueChart({ points, highlight, label }: RevenueChartProps) {
  const wide = useIsWideViewport();

  if (!wide) {
    return <MobileRevenueChart points={points} highlight={highlight} label={label} />;
  }

  const peak = points.reduce((max, point) => (point.amount > max ? point.amount : max), 0);
  const scale = peak === 0 ? 1 : peak;
  const innerHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const barWidth = (WIDTH - PAD_X * 2 - GAP * (points.length - 1)) / points.length;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label} className="block w-full">
      {points.map((point, index) => {
        const active = point.month === highlight;
        const height = Math.max((point.amount / scale) * innerHeight, 2);
        const x = PAD_X + index * (barWidth + GAP);
        const y = PAD_TOP + innerHeight - height;
        const centerX = x + barWidth / 2;

        return (
          <g key={point.month}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={height}
              rx={BAR_RADIUS}
              fill={active ? "#2563eb" : "#f5f5f5"}
              stroke="#e5e5e5"
            />
            <text x={centerX} y={y - 8} textAnchor="middle" fontSize={12} fill={active ? "#171717" : "#262626"}>
              {baht(point.amount)}
            </text>
            <text x={centerX} y={HEIGHT - 8} textAnchor="middle" fontSize={12} fill={active ? "#171717" : "#262626"}>
              {point.month}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function MobileRevenueChart({ points, highlight, label }: RevenueChartProps) {
  const peak = points.reduce((max, point) => (point.amount > max ? point.amount : max), 0);
  const scale = peak === 0 ? 1 : peak;
  const innerHeight = MOBILE_HEIGHT - MOBILE_PAD_TOP - MOBILE_PAD_BOTTOM;
  const barWidth = (MOBILE_WIDTH - MOBILE_PAD_X * 2 - MOBILE_GAP * (points.length - 1)) / points.length;

  return (
    <svg viewBox={`0 0 ${MOBILE_WIDTH} ${MOBILE_HEIGHT}`} role="img" aria-label={label} className="block w-full">
      {points.map((point, index) => {
        const active = point.month === highlight;
        const height = Math.max((point.amount / scale) * innerHeight, 2);
        const x = MOBILE_PAD_X + index * (barWidth + MOBILE_GAP);
        const y = MOBILE_PAD_TOP + innerHeight - height;
        const centerX = x + barWidth / 2;

        return (
          <g key={point.month}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={height}
              rx={BAR_RADIUS}
              fill={active ? "#2563eb" : "#f5f5f5"}
              stroke="#e5e5e5"
            />
            {active && (
              <text x={centerX} y={y - 8} textAnchor="middle" fontSize={MOBILE_FONT} fill="#171717">
                {baht(point.amount)}
              </text>
            )}
            <text
              x={centerX}
              y={MOBILE_HEIGHT - 6}
              textAnchor="middle"
              fontSize={MOBILE_FONT}
              fill={active ? "#171717" : "#262626"}
            >
              {point.month}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
