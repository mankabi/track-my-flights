import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Flight } from "../lib/api";
import {
  formatDate,
  formatDayOffset,
  formatDuration,
  formatNumber,
  travelClassBadge,
} from "../lib/format";
import { formatClock, formatDistance, useUnits } from "../lib/units";
import Card from "../components/Card";
import PillTabs from "../components/PillTabs";
import ConfirmModal from "../components/ConfirmModal";
import { CommentIcon, EditIcon, SearchIcon, TrashIcon } from "../components/icons";
import { useI18n } from "../i18n";

type SortOrder = "desc" | "asc";

export default function FlightsList() {
  const { t, tn, lang } = useI18n();
  const { distanceUnit, timeFormat } = useUnits();
  const navigate = useNavigate();
  const [flights, setFlights] = useState<Flight[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("all");
  const [sort, setSort] = useState<SortOrder>("desc");
  const [pendingDelete, setPendingDelete] = useState<Flight | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    api
      .flights.list("all")
      .then(setFlights)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(load, []);

  const years = useMemo(() => {
    const set = new Set((flights ?? []).map((f) => f.date.slice(0, 4)));
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [flights]);

  const filtered = useMemo(() => {
    let rows = flights ?? [];
    if (year !== "all") rows = rows.filter((f) => f.date.slice(0, 4) === year);
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter((f) => {
        const hay = [
          f.dep_iata,
          f.arr_iata,
          f.dep_city,
          f.arr_city,
          f.dep_airport_name,
          f.arr_airport_name,
          f.dep_country,
          f.arr_country,
          f.airline,
          f.flight_no,
          f.aircraft_type,
          f.aircraft_reg,
          f.aircraft_name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    const sorted = [...rows].sort((a, b) => a.seq - b.seq);
    if (sort === "desc") sorted.reverse();
    return sorted;
  }, [flights, year, query, sort]);

  const requestDelete = (f: Flight) => setPendingDelete(f);
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.flights.remove(pendingDelete.id);
      setPendingDelete(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-ink-title">{t("list.title")}</h1>
        <Link
          to="/flights/new"
          className="rounded-full bg-brand px-5 py-2 text-sm font-medium text-ink-inverse hover:bg-brand-2"
        >
          {t("list.addNew")}
        </Link>
      </div>

      {error && (
        <Card className="border-line-danger-soft bg-danger-wash text-sm text-ink-danger">
          {t("list.loadError", { error })}
        </Card>
      )}

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="relative w-full max-w-sm">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-faint">
              <SearchIcon size={16} />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("list.searchPlaceholder")}
              className="w-full rounded-full border border-line py-2 pl-9 pr-4 text-sm focus:border-line-accent focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSort(sort === "desc" ? "asc" : "desc")}
              className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink-soft hover:border-line-accent hover:text-ink-brand"
            >
              {sort === "desc" ? t("list.sortDesc") : t("list.sortAsc")}
            </button>
          </div>
        </div>
        <PillTabs
          value={year}
          onChange={setYear}
          options={[{ value: "all", label: t("list.all") }, ...years.map((y) => ({ value: y, label: y }))]}
        />
        <p className="text-sm text-ink-faint">{tn("list.totalCount", filtered.length, { n: formatNumber(filtered.length, lang) })}</p>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-faint">
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">{t("list.colDate")}</th>
              <th className="px-4 py-3 font-medium">{t("list.colDep")}</th>
              <th className="px-4 py-3 font-medium">{t("list.colArr")}</th>
              <th className="px-4 py-3 font-medium">{t("list.colDistanceDuration")}</th>
              <th className="px-4 py-3 font-medium">{t("list.colAirline")}</th>
              <th className="px-4 py-3 font-medium">{t("list.colAircraft")}</th>
              <th className="px-4 py-3 font-medium">{t("list.colSeat")}</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => (
              <tr key={f.id} className="group border-b border-line-soft last:border-0 hover:bg-accent-wash/40">
                <td className="px-4 py-3 align-top text-ink-faint">{f.seq}</td>
                <td className="px-4 py-3 align-top">
                  <div className="font-medium text-ink-brand">{formatDate(f.date, lang)}</div>
                  <div className="text-xs text-ink-faint">
                    {formatClock(f.dep_time, timeFormat)} → {formatClock(f.arr_time, timeFormat)}
                    {f.arr_day_offset !== 0 && (
                      <sup className="ml-0.5 text-ink-accent">{formatDayOffset(f.arr_day_offset)}</sup>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="font-semibold tracking-wide text-ink-title">{f.dep_iata}</div>
                  <div className="text-xs text-ink-faint">{f.dep_city ?? "-"}</div>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="font-semibold tracking-wide text-ink-title">{f.arr_iata}</div>
                  <div className="text-xs text-ink-faint">{f.arr_city ?? "-"}</div>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="text-ink-brand">{formatDistance(f.distance_km, distanceUnit, lang)}</div>
                  <div className="text-xs text-ink-faint">{formatDuration(f.duration_min)}</div>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="text-ink-brand">{f.airline ?? "-"}</div>
                  <div className="text-xs text-ink-faint">{f.flight_no ?? "-"}</div>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="text-ink-brand">{f.aircraft_type ?? "-"}</div>
                  <div className="text-xs text-ink-faint">{f.aircraft_reg ?? ""}</div>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-full bg-accent-wash px-2 py-0.5 text-xs font-semibold text-ink-brand">
                      {travelClassBadge(f.travel_class)}
                    </span>
                    <span className="text-xs text-ink-faint">{f.seat ?? ""}</span>
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  <div className="flex items-center justify-end gap-2">
                    {f.comment && (
                      <span title={f.comment} className="text-ink-faint">
                        <CommentIcon size={14} />
                      </span>
                    )}
                    <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => navigate(`/flights/${f.id}/edit`)}
                        className="rounded-full p-1.5 text-ink-faint hover:bg-surface hover:text-ink-brand"
                        aria-label={t("list.editAria")}
                      >
                        <EditIcon size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => requestDelete(f)}
                        className="rounded-full p-1.5 text-ink-faint hover:bg-surface hover:text-ink-danger"
                        aria-label={t("list.deleteAria")}
                      >
                        <TrashIcon size={15} />
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {flights && filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-ink-faint">{t("list.emptyFiltered")}</p>
        )}
      </Card>

      <ConfirmModal
        open={pendingDelete != null}
        title={
          pendingDelete
            ? t("list.deleteConfirmTitle", { dep: pendingDelete.dep_iata, arr: pendingDelete.arr_iata })
            : ""
        }
        description={pendingDelete ? t("list.deleteConfirmDesc", { date: formatDate(pendingDelete.date, lang) }) : undefined}
        confirmLabel={deleting ? t("list.deletingLabel") : t("list.deleteLabel")}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
