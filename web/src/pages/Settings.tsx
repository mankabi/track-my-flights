import { useEffect, useState } from "react";
import Card from "../components/Card";
import RadioGroup from "../components/RadioGroup";
import { DownloadIcon } from "../components/icons";
import { api, type HealthResult } from "../lib/api";
import { useI18n, type Pref } from "../i18n";
import { useUnits, type DistancePref, type TimePref } from "../lib/units";
import { useTheme, type ThemePref } from "../lib/theme";

export default function Settings() {
  const { t, tn, pref, setPref } = useI18n();
  const { distancePref, setDistancePref, timePref, setTimePref } = useUnits();
  const { themePref, setThemePref } = useTheme();
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
      <h1 className="text-xl font-semibold text-ink-title">{t("settings.title")}</h1>

      <Card>
        <h2 className="mb-1 text-sm font-semibold text-ink-muted">{t("settings.exportTitle")}</h2>
        <p className="mb-4 text-sm text-ink-muted">{t("settings.exportDesc")}</p>
        <div className="flex flex-wrap gap-3">
          <a
            href="/api/export/json"
            className="flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-ink-inverse hover:bg-brand-2"
          >
            <DownloadIcon size={16} />
            {t("settings.exportJson")}
          </a>
          <a
            href="/api/export/csv"
            className="flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-sm font-medium text-ink-brand hover:border-line-accent"
          >
            <DownloadIcon size={16} />
            {t("settings.exportCsv")}
          </a>
        </div>

      </Card>

      {/* 백업(DB 파일)은 내보내기와 목적이 달라 별도 카드 (D33-1) */}
      <Card>
        <h2 className="mb-2 text-sm font-semibold text-ink-muted">{t("settings.backupCardTitle")}</h2>
        <p className="text-sm text-ink-muted">
          {t("settings.dbLocationLabel")}{" "}
          <code className="rounded bg-surface-inset px-1.5 py-0.5 text-xs text-ink-brand">data/flights.db</code>
        </p>
        <p className="mt-1 text-sm text-ink-muted">{t("settings.dbLocationDesc")}</p>
      </Card>

      {/* 데이터 출처 카드는 D33/D31로 삭제 — 편수 카운트만 앱 정보로 흡수 (마이그레이션 서비스명 무언급) */}
      <Card>
        <h2 className="mb-2 text-sm font-semibold text-ink-muted">{t("settings.appInfoTitle")}</h2>
        <p className="text-sm text-ink-brand">{health ? `Track My Flights · v${health.version}` : "-"}</p>
        {health && (
          <p className="mt-1 text-sm text-ink-muted">
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
        <RadioGroup
          label={t("settings.themeCardTitle")}
          value={themePref}
          onChange={(v) => setThemePref(v as ThemePref)}
          options={[
            { value: "auto", label: t("settings.themeAuto") },
            { value: "light", label: t("settings.themeLight") },
            { value: "dark", label: t("settings.themeDark") },
          ]}
        />
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-ink-muted">{t("settings.unitsCardTitle")}</h2>
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
