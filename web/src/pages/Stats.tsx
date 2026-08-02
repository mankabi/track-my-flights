import { useEffect, useMemo, useState } from "react";
import { api, type StatsResult } from "../lib/api";
import {
  formatDate,
  formatDuration,
  formatFixed,
  formatNumber,
  formatPercent,
} from "../lib/format";
import { formatDistance, useUnits, type DistanceUnit } from "../lib/units";
import Card from "../components/Card";
import PillTabs from "../components/PillTabs";
import { useI18n, type MsgKey } from "../i18n";

const DAY_MIN = 1440;
const WEEK_MIN = DAY_MIN * 7;
const MONTH_MIN = DAY_MIN * 30.44;
const YEAR_MIN = DAY_MIN * 365.25;

// label은 렌더 시점에 t()로 해석 (모듈 수준 상수라 훅을 못 쓴다 — Distribution 컴포넌트가 labelKey를 번역).
const CLASS_ITEMS: { key: string; labelKey: MsgKey }[] = [
  { key: "economy", labelKey: "common.classEconomy" },
  { key: "economyplus", labelKey: "common.classEconomyPlus" },
  { key: "business", labelKey: "common.classBusiness" },
  { key: "first", labelKey: "common.classFirst" },
  { key: "private", labelKey: "common.classPrivate" },
  { key: "none", labelKey: "common.unspecified" },
];
const SEAT_POS_ITEMS: { key: string; labelKey: MsgKey }[] = [
  { key: "window", labelKey: "common.seatWindow" },
  { key: "middle", labelKey: "common.seatMiddle" },
  { key: "aisle", labelKey: "common.seatAisle" },
  { key: "none", labelKey: "common.unspecified" },
];
const REASON_ITEMS: { key: string; labelKey: MsgKey }[] = [
  { key: "personal", labelKey: "common.reasonPersonal" },
  { key: "business", labelKey: "common.reasonBusiness" },
  { key: "virtual", labelKey: "common.reasonVirtual" },
  { key: "none", labelKey: "common.unspecified" },
];

const SEGMENT_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export default function Stats() {
  const { t, tn, lang } = useI18n();
  const { distanceUnit } = useUnits();
  const otherDistanceUnit: DistanceUnit = distanceUnit === "km" ? "mi" : "km";
  const [year, setYear] = useState("all");
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .stats(year)
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [year]);

  const years = useMemo(() => (stats ? stats.perYear.map((p) => p.year) : []), [stats]);

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <Card className="border-line-danger-soft bg-danger-wash text-sm text-ink-danger">
          {t("stats.loadError", { error })}
        </Card>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <p className="text-sm text-ink-faint">{t("common.loading")}</p>
      </div>
    );
  }

  const totals = stats.totals;
  const day = totals.min / DAY_MIN;
  const week = totals.min / WEEK_MIN;
  const month = totals.min / MONTH_MIN;
  const yearFrac = totals.min / YEAR_MIN;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-ink-title">{t("stats.title")}</h1>
      </div>

      <PillTabs
        value={year}
        onChange={setYear}
        options={[{ value: "all", label: t("stats.all") }, ...years.map((y) => ({ value: y, label: y }))]}
      />

      {/* ① 거리 / ② 시간 / ③ 편수 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink-muted">{t("stats.sectionDistance")}</h2>
          <div className="text-2xl font-semibold text-ink-title">{formatDistance(totals.km, distanceUnit, lang)}</div>
          <div className="text-sm text-ink-faint">{formatDistance(totals.km, otherDistanceUnit, lang)}</div>
          <dl className="mt-4 space-y-1.5 text-sm">
            <Row label={t("stats.earthCircum")} value={t("stats.multiplierValue", { n: formatFixed(totals.earthCircum, 2) })} />
            <Row label={t("stats.moonDist")} value={t("stats.multiplierValue", { n: formatFixed(totals.moonDist, 3) })} />
            <Row label={t("stats.sunDist")} value={t("stats.multiplierValue", { n: formatFixed(totals.sunDist, 4) })} />
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink-muted">{t("stats.sectionDuration")}</h2>
          <div className="text-2xl font-semibold text-ink-title">{formatDuration(totals.min)}</div>
          <dl className="mt-4 space-y-1.5 text-sm">
            <Row label={t("stats.day")} value={tn("stats.dayValue", day, { n: formatFixed(day, 1) })} />
            <Row label={t("stats.week")} value={tn("stats.weekValue", week, { n: formatFixed(week, 1) })} />
            <Row label={t("stats.month")} value={tn("stats.monthValue", month, { n: formatFixed(month, 2) })} />
            <Row label={t("stats.year")} value={tn("stats.yearValue", yearFrac, { n: formatFixed(yearFrac, 3) })} />
          </dl>
        </Card>
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink-muted">{t("stats.sectionFlights")}</h2>
          <div className="text-2xl font-semibold text-ink-title">{tn("stats.flightCount", totals.flights, { n: formatNumber(totals.flights, lang) })}</div>
          <dl className="mt-4 space-y-1.5 text-sm">
            <Row label={t("stats.domestic")} value={tn("stats.flightCount", stats.scope.domestic, { n: formatNumber(stats.scope.domestic, lang) })} />
            <Row label={t("stats.intra")} value={tn("stats.flightCount", stats.scope.intra, { n: formatNumber(stats.scope.intra, lang) })} />
            <Row label={t("stats.inter")} value={tn("stats.flightCount", stats.scope.inter, { n: formatNumber(stats.scope.inter, lang) })} />
          </dl>
        </Card>
      </div>

      {/* ④ 기록 */}
      <Card>
        <h2 className="mb-4 text-sm font-semibold text-ink-muted">{t("stats.sectionRecords")}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RecordLine label={t("stats.longestDistance")} r={stats.records.longestKm} />
          <RecordLine label={t("stats.longestDuration")} r={stats.records.longestMin} />
          <RecordLine label={t("stats.shortestDistance")} r={stats.records.shortestKm} />
          <RecordLine label={t("stats.shortestDuration")} r={stats.records.shortestMin} />
          <RecordLine label={t("stats.fastest")} r={stats.records.fastest} extraKmh />
          <RecordLine label={t("stats.slowest")} r={stats.records.slowest} extraKmh />
          <div className="rounded-xl bg-accent-wash/50 px-4 py-3">
            <div className="text-xs text-ink-muted">{t("stats.average")}</div>
            <div className="mt-0.5 text-sm text-ink-brand">
              {formatDistance(stats.records.avgKm, distanceUnit, lang)} · {formatDuration(stats.records.avgMin)}
            </div>
          </div>
        </div>
      </Card>

      {/* ⑤ Top10 3열 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TopList
          title={t("stats.topAirports")}
          total={stats.totals.flights * 2}
          items={stats.topAirports.map(([iata, n, city]) => ({
            key: iata,
            name: iata,
            sub: city ?? undefined,
            count: n,
          }))}
        />
        <TopList
          title={t("stats.topAirlines")}
          total={stats.totals.flights}
          items={stats.topAirlines.map(([name, n]) => ({ key: name, name, count: n }))}
        />
        <TopList
          title={t("stats.topAircraft")}
          total={stats.totals.flights}
          items={stats.topAircraft.map(([name, n]) => ({ key: name, name, count: n }))}
        />
      </div>

      {/* ⑥ Top10 루트 */}
      <Card>
        <h2 className="mb-4 text-sm font-semibold text-ink-muted">{t("stats.sectionTopRoutes")}</h2>
        <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
          {stats.topRoutes.map(([route, n], i) => {
            const [dep, arr] = route.split("-");
            const max = stats.topRoutes[0]?.[1] ?? 1;
            return (
              <div key={route} className="flex items-center gap-3 py-1">
                <span className="w-5 shrink-0 text-xs text-ink-faint">{i + 1}</span>
                <span className="w-28 shrink-0 font-medium text-ink-title">
                  {dep} → {arr}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-inset">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${(n / max) * 100}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-sm text-ink-muted">{n}</span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ⑦ 분포 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Distribution title={t("stats.distClass")} items={CLASS_ITEMS} counts={stats.classes} />
        <Distribution title={t("stats.distSeatPos")} items={SEAT_POS_ITEMS} counts={stats.seatPos} />
        <Distribution title={t("stats.distReason")} items={REASON_ITEMS} counts={stats.reasons} />
      </div>

      {/* ⑧ 카운트 요약 */}
      <Card>
        <h2 className="mb-4 text-sm font-semibold text-ink-muted">{t("stats.sectionCountSummary")}</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <CountTile label={t("stats.countAirports")} value={stats.distinct.airports} />
          <CountTile label={t("stats.countAirlines")} value={stats.distinct.airlines} />
          <CountTile label={t("stats.countAircraftTypes")} value={stats.distinct.aircraftTypes} />
          <CountTile label={t("stats.countRegistrations")} value={stats.distinct.registrations} />
          <CountTile label={t("stats.countRoutes")} value={stats.distinct.routes} />
          <CountTile label={t("stats.countCountries")} value={stats.distinct.countries} />
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="font-medium text-ink-brand">{value}</dd>
    </div>
  );
}

interface RecordSummary {
  seq: number;
  fm_no: number | null;
  id: number;
  date: string;
  dep: string;
  arr: string;
  km: number | null;
  min: number | null;
  kmh?: number;
}

function RecordLine({ label, r, extraKmh }: { label: string; r: RecordSummary | null; extraKmh?: boolean }) {
  const { t, lang } = useI18n();
  const { distanceUnit } = useUnits();
  return (
    <div className="rounded-xl bg-accent-wash/50 px-4 py-3">
      <div className="text-xs text-ink-muted">{label}</div>
      {r ? (
        <div className="mt-0.5 text-sm text-ink-brand">
          {formatDistance(r.km, distanceUnit, lang)} · {formatDuration(r.min)}
          {/* 속도(km/h)는 거리 단위 선호와 무관 — mph 환산은 D32 스코프 밖(거리 단위 설정만 존재) */}
          {extraKmh && r.kmh != null ? ` · ${formatNumber(r.kmh, lang)} km/h` : ""} · {r.dep} → {r.arr} ·{" "}
          {formatDate(r.date, lang)}
        </div>
      ) : (
        <div className="mt-0.5 text-sm text-ink-faint">{t("stats.noRecord")}</div>
      )}
    </div>
  );
}

function TopList({
  title,
  items,
  total,
}: {
  title: string;
  items: { key: string; name: string; sub?: string; count: number }[];
  total: number;
}) {
  const { t } = useI18n();
  const max = items[0]?.count ?? 1;
  return (
    <Card>
      <h2 className="mb-4 text-sm font-semibold text-ink-muted">{title}</h2>
      <div className="space-y-2.5">
        {items.length === 0 && <p className="text-sm text-ink-faint">{t("stats.noData")}</p>}
        {items.map((item, i) => (
          <div key={item.key}>
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 truncate">
                <span className="w-4 shrink-0 text-xs text-ink-faint">{i + 1}</span>
                <span className="truncate font-medium text-ink-title">{item.name}</span>
                {item.sub && <span className="truncate text-xs text-ink-faint">{item.sub}</span>}
              </span>
              <span className="shrink-0 pl-2 text-xs text-ink-muted">
                {item.count} · {formatPercent(item.count, total)}%
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-inset">
              <div className="h-full rounded-full bg-accent" style={{ width: `${(item.count / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Distribution({
  title,
  items,
  counts,
}: {
  title: string;
  items: { key: string; labelKey: MsgKey }[];
  counts: Record<string, number>;
}) {
  const { t } = useI18n();
  const total = items.reduce((s, it) => s + (counts[it.key] ?? 0), 0);
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-ink-muted">{title}</h2>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-inset">
        {items.map((it, i) => {
          const c = counts[it.key] ?? 0;
          if (!c) return null;
          return (
            <div
              key={it.key}
              style={{ width: `${(c / (total || 1)) * 100}%`, backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }}
            />
          );
        })}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {items.map((it, i) => (
          <li key={it.key} className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-ink-muted">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }}
              />
              {t(it.labelKey)}
            </span>
            <span className="font-medium text-ink-brand">
              {counts[it.key] ?? 0} ({formatPercent(counts[it.key] ?? 0, total)}%)
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-accent-wash/50 px-4 py-3 text-center">
      <div className="text-lg font-semibold text-ink-title">{value}</div>
      <div className="text-xs text-ink-muted">{label}</div>
    </div>
  );
}
