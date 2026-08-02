import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Flight, type StatsResult } from "../lib/api";
import { formatDate, formatDuration, formatFixed, formatNumber, todayStr } from "../lib/format";
import { formatDistance, useUnits } from "../lib/units";
import Card from "../components/Card";
import WorldMap from "../components/WorldMap";
import RoutePair from "../components/RoutePair";
import { ChevronRightIcon, CommentIcon, GlobeIcon } from "../components/icons";
import { useI18n } from "../i18n";

export default function Dashboard() {
  const { t, tn, lang } = useI18n();
  const { distanceUnit } = useUnits();
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [flights, setFlights] = useState<Flight[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.stats("all"), api.flights.list("all")])
      .then(([s, f]) => {
        setStats(s);
        setFlights(f);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const today = todayStr();
  const upcoming = (flights ?? [])
    .filter((f) => f.date > today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const recent = (flights ?? []).filter((f) => f.date <= today).slice(0, 5); // 서버가 최신순으로 내려줌 (미래 예약편은 위 "다가오는 비행"에서 다룬다)

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-8">
      {error && (
        <Card className="border-line-danger-soft bg-danger-wash text-sm text-ink-danger">
          {t("dashboard.loadError", { error })}
        </Card>
      )}

      {/* 채널아트 — Korea-centric 항로 히어로 (브랜딩 v1.3.x) */}
      <div className="overflow-hidden rounded-2xl">
        <img src="/hero.png" alt="" className="h-40 w-full object-cover sm:h-52" />
      </div>

      {/* 스탯 카드 4개 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t("dashboard.statFlights")}
          value={stats ? tn("dashboard.statFlightsValue", stats.totals.flights, { n: formatNumber(stats.totals.flights, lang) }) : "-"}
        />
        <StatTile
          label={t("dashboard.statDistance")}
          value={stats ? formatDistance(stats.totals.km, distanceUnit, lang) : "-"}
          sub={stats ? t("dashboard.earthLaps", { n: formatFixed(stats.totals.earthCircum, 2) }) : undefined}
        />
        <StatTile label={t("dashboard.statDuration")} value={stats ? formatDuration(stats.totals.min) : "-"} />
        <StatTile
          label={t("dashboard.statAirportsCountries")}
          value={stats ? tn("dashboard.statAirportsValue", stats.distinct.airports) : "-"}
          sub={stats ? tn("dashboard.statCountriesValue", stats.distinct.countries) : undefined}
        />
      </div>

      {/* 세계지도 */}
      <Card>
        <div className="mb-4 flex items-center gap-2 text-ink-title">
          <GlobeIcon size={18} />
          <h2 className="text-base font-semibold">{t("dashboard.mapTitle")}</h2>
        </div>
        <WorldMap year="all" />
      </Card>

      {/* 다가오는 비행 */}
      {upcoming.length > 0 && (
        <Card className="border-line-accent/30 bg-accent-wash/60">
          <h2 className="mb-4 text-base font-semibold text-ink-title">{t("dashboard.upcomingTitle")}</h2>
          <div className="space-y-3">
            {upcoming.map((f) => (
              <div
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface/80 px-4 py-3"
              >
                <RoutePair depIata={f.dep_iata} arrIata={f.arr_iata} depCity={f.dep_city} arrCity={f.arr_city} />
                <div className="text-right text-sm text-ink-muted">
                  <div className="font-medium text-ink-brand">{formatDate(f.date, lang)}</div>
                  <div>
                    {f.airline ?? "-"} {f.flight_no ?? ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 최근 비행 5건 */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-title">{t("dashboard.recentTitle")}</h2>
          <Link
            to="/flights"
            className="flex items-center gap-1 text-sm font-medium text-ink-accent hover:text-ink-brand"
          >
            {t("dashboard.viewAll")} <ChevronRightIcon size={14} />
          </Link>
        </div>
        <div className="divide-y divide-line-soft">
          {recent.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
              <RoutePair depIata={f.dep_iata} arrIata={f.arr_iata} depCity={f.dep_city} arrCity={f.arr_city} />
              <div className="flex items-center gap-2 text-right text-sm text-ink-muted">
                {f.comment && (
                  <span title={f.comment} className="text-ink-faint">
                    <CommentIcon size={14} />
                  </span>
                )}
                <div>
                  <div className="font-medium text-ink-brand">{formatDate(f.date, lang)}</div>
                  <div>
                    {f.airline ?? "-"} {f.flight_no ?? ""}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {flights && flights.length === 0 && (
            <p className="py-6 text-center text-sm text-ink-faint">{t("dashboard.empty")}</p>
          )}
        </div>
      </Card>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <div className="text-sm text-ink-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink-title">{value}</div>
      {sub && <div className="mt-1 text-xs font-medium text-ink-accent">{sub}</div>}
    </Card>
  );
}
