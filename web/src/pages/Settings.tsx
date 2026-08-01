import { useEffect, useState } from "react";
import Card from "../components/Card";
import RadioGroup from "../components/RadioGroup";
import { DownloadIcon } from "../components/icons";
import { api, type HealthResult } from "../lib/api";
import { useI18n, type Pref } from "../i18n";
import { useUnits, type DistancePref, type TimePref } from "../lib/units";

export default function Settings() {
  const { t, tn, pref, setPref } = useI18n();
  const { distancePref, setDistancePref, timePref, setTimePref } = useUnits();
  const [health, setHealth] = useState<HealthResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((h) => {
        if (!cancelled) setHealth(h);
      })
      .catch(() => {
        /* 조회 실패 시 "-" 폴백 유지 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <h1 className="text-xl font-semibold text-navy-900">{t("settings.title")}</h1>

      <Card>
        <h2 className="mb-1 text-sm font-semibold text-slate-500">{t("settings.exportTitle")}</h2>
        <p className="mb-4 text-sm text-slate-500">{t("settings.exportDesc")}</p>
        <div className="flex flex-wrap gap-3">
          <a
            href="/api/export/json"
            className="flex items-center gap-2 rounded-full bg-navy-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-navy-800"
          >
            <DownloadIcon size={16} />
            {t("settings.exportJson")}
          </a>
          <a
            href="/api/export/csv"
            className="flex items-center gap-2 rounded-full border border-slate-200 px-5 py-2.5 text-sm font-medium text-navy-800 hover:border-navy-600"
          >
            <DownloadIcon size={16} />
            {t("settings.exportCsv")}
          </a>
        </div>

      </Card>

      {/* 백업(DB 파일)은 내보내기와 목적이 달라 별도 카드 (D33-1) */}
      <Card>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">{t("settings.backupCardTitle")}</h2>
        <p className="text-sm text-slate-500">
          {t("settings.dbLocationLabel")}{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-navy-800">data/flights.db</code>
        </p>
        <p className="mt-1 text-sm text-slate-500">{t("settings.dbLocationDesc")}</p>
      </Card>

      {/* 데이터 출처 카드는 D33/D31로 삭제 — 편수 카운트만 앱 정보로 흡수 (마이그레이션 서비스명 무언급) */}
      <Card>
        <h2 className="mb-2 text-sm font-semibold text-slate-500">{t("settings.appInfoTitle")}</h2>
        <p className="text-sm text-navy-800">{health ? `Track My Flights · v${health.version}` : "-"}</p>
        {health && (
          <p className="mt-1 text-sm text-slate-500">
            {health.flights.migrated > 0
              ? t("settings.appInfoFlightsMigrated", {
                  total: tn("settings.flightCount", health.flights.total),
                  migrated: tn("settings.flightCount", health.flights.migrated),
                })
              : t("settings.appInfoFlights", { total: tn("settings.flightCount", health.flights.total) })}
          </p>
        )}
      </Card>

      <Card>
        <RadioGroup
          label={t("settings.langCardTitle")}
          value={pref}
          onChange={(v) => setPref(v as Pref)}
          options={[
            { value: "auto", label: t("settings.langAuto") },
            { value: "ko", label: t("settings.langKo") },
            { value: "en", label: t("settings.langEn") },
          ]}
        />
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-500">{t("settings.unitsCardTitle")}</h2>
        <div className="space-y-4">
          <RadioGroup
            label={t("settings.unitsDistanceLabel")}
            value={distancePref}
            onChange={(v) => setDistancePref(v as DistancePref)}
            options={[
              { value: "auto", label: t("settings.unitsAuto") },
              { value: "km", label: t("settings.unitsKm") },
              { value: "mi", label: t("settings.unitsMi") },
            ]}
          />
          <RadioGroup
            label={t("settings.unitsTimeLabel")}
            value={timePref}
            onChange={(v) => setTimePref(v as TimePref)}
            options={[
              { value: "auto", label: t("settings.unitsAuto") },
              { value: "h24", label: t("settings.unitsH24") },
              { value: "h12", label: t("settings.unitsH12") },
            ]}
          />
        </div>
      </Card>
    </div>
  );
}
