import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  api,
  getFlightById,
  type Airline,
  type Airport,
  type Flight,
  type FlightInput,
  type SuggestResult,
} from "../lib/api";
import { addDays, diffDays, formatDuration, parseDurationToMinutes } from "../lib/format";
import { extractFlightNoCode, previewNormalizeFlightNo } from "../lib/flightno";
import Card from "../components/Card";
import AirportInput from "../components/AirportInput";
import AirlineInput from "../components/AirlineInput";
import TimeInput from "../components/TimeInput";
import TextAutocomplete from "../components/TextAutocomplete";
import RadioGroup from "../components/RadioGroup";
import { SwapIcon } from "../components/icons";
import { useI18n } from "../i18n";
import { KM_TO_MI, useUnits } from "../lib/units";

interface FormState {
  dep_iata: string;
  arr_iata: string;
  date: string;
  dep_time: string;
  arr_time: string;
  arr_date: string;
  distance_km: string;
  duration_text: string;
  airline: string;
  flight_no: string;
  aircraft_type: string;
  aircraft_reg: string;
  aircraft_name: string;
  seat: string;
  seat_pos: string;
  travel_class: string;
  flight_role: string;
  flight_reason: string;
  comment: string;
}

const EMPTY: FormState = {
  dep_iata: "",
  arr_iata: "",
  date: "",
  dep_time: "",
  arr_time: "",
  arr_date: "",
  distance_km: "",
  duration_text: "",
  airline: "",
  flight_no: "",
  aircraft_type: "",
  aircraft_reg: "",
  aircraft_name: "",
  seat: "",
  seat_pos: "",
  travel_class: "",
  flight_role: "passenger",
  flight_reason: "personal",
  comment: "",
};

function flightToForm(f: Flight): FormState {
  return {
    dep_iata: f.dep_iata,
    arr_iata: f.arr_iata,
    date: f.date,
    dep_time: f.dep_time ?? "",
    arr_time: f.arr_time ?? "",
    arr_date: addDays(f.date, f.arr_day_offset ?? 0),
    distance_km: f.distance_km != null ? String(f.distance_km) : "",
    duration_text: f.duration_min != null ? formatDuration(f.duration_min) : "",
    airline: f.airline ?? "",
    flight_no: f.flight_no ?? "",
    aircraft_type: f.aircraft_type ?? "",
    aircraft_reg: f.aircraft_reg ?? "",
    aircraft_name: f.aircraft_name ?? "",
    seat: f.seat ?? "",
    seat_pos: f.seat_pos ?? "",
    travel_class: f.travel_class ?? "",
    flight_role: f.flight_role ?? "passenger",
    flight_reason: f.flight_reason ?? "personal",
    comment: f.comment ?? "",
  };
}

const IATA_RE = /^[A-Za-z]{3}$/;

export default function FlightForm() {
  const { t } = useI18n();
  const { timeFormat, distanceUnit } = useUnits();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const editingId = id ? Number(id) : null;

  // 거리 단위 일관성 (D32-1): 선호 단위가 mi면 입력·표시를 mi로 하되, 내부 상태·전송은 항상 km.
  // 변환은 "표시 계층"에서만 일어난다 — 사용자가 필드를 안 건드리면 km 원값이 그대로 전송되므로
  // 이관 데이터(D5)의 원값이 편집 화면을 거쳐도 ±1km 흔들리지 않는다.
  const kmToDisplay = (km: string): string => {
    if (distanceUnit === "km" || !km.trim()) return km;
    const n = Number(km);
    return Number.isFinite(n) ? String(Math.round(n * KM_TO_MI)) : km;
  };
  const displayToKm = (v: string): string => {
    if (distanceUnit === "km" || !v.trim()) return v;
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.round(n / KM_TO_MI)) : v;
  };

  const [form, setForm] = useState<FormState>(EMPTY);
  const [depAirport, setDepAirport] = useState<Airport | null>(null);
  const [arrAirport, setArrAirport] = useState<Airport | null>(null);
  const [airlineResolved, setAirlineResolved] = useState<Airline | null>(null);
  const [distanceTouched, setDistanceTouched] = useState(false);
  const [durationTouched, setDurationTouched] = useState(false);
  const [arrDateTouched, setArrDateTouched] = useState(false);
  const [airlineTouched, setAirlineTouched] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [suggest, setSuggest] = useState<SuggestResult>({ airlines: [], aircraftTypes: [], registrations: [] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(editingId != null);
  const [saving, setSaving] = useState(false);
  const airlineInputRef = useRef<HTMLInputElement>(null);
  // 편집 모드 진입 시점의 편명 코드. 이 값과 같은 동안은 항공사 자동 채움을 건너뛴다
  // (불러온 직후 저장돼 있던 항공사를 덮어쓰지 않기 위해 — 참조DB에 없는 자유 입력 항공사 보호).
  const loadedFlightNoCodeRef = useRef<string | null>(null);

  useEffect(() => {
    api.suggest().then(setSuggest).catch(() => {});
  }, []);

  useEffect(() => {
    if (editingId == null) return;
    let cancelled = false;
    getFlightById(editingId)
      .then((f) => {
        if (cancelled || !f) return;
        setForm(flightToForm(f));
        setDistanceTouched(f.distance_km != null);
        setDurationTouched(f.duration_min != null);
        setArrDateTouched(f.arr_day_offset !== 0);
        loadedFlightNoCodeRef.current = extractFlightNoCode(f.flight_no ?? "");
        if (f.airline) {
          // 저장된 항공사명을 역조회해 정확일치면 코드+resolved로 세팅 (D25). 아니면 원문 유지.
          api
            .airlines.search(f.airline)
            .then((rows) => {
              if (cancelled) return;
              const exact = rows.find((r) => r.name.toLowerCase() === f.airline!.toLowerCase());
              if (exact) {
                setForm((prev) => ({ ...prev, airline: exact.iata }));
                setAirlineResolved(exact);
              }
            })
            .catch(() => {});
        }
        if (f.dep_city || f.dep_airport_name) {
          setDepAirport({
            iata: f.dep_iata,
            name: f.dep_airport_name ?? "",
            city: f.dep_city,
            country: f.dep_country,
            country_code: null,
            continent: null,
            lat: null,
            lon: null,
            tz: null,
            used: 0,
          });
        }
        if (f.arr_city || f.arr_airport_name) {
          setArrAirport({
            iata: f.arr_iata,
            name: f.arr_airport_name ?? "",
            city: f.arr_city,
            country: f.arr_country,
            country_code: null,
            continent: null,
            lat: null,
            lon: null,
            tz: null,
            used: 0,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editingId]);

  // D23: 도착 날짜 기본값 = 출발 날짜, 단 사용자가 아직 손대지 않은 경우에만 따라간다 (touched 패턴).
  useEffect(() => {
    if (arrDateTouched) return;
    setForm((f) => (f.arr_date === f.date ? f : { ...f, arr_date: f.date }));
  }, [form.date, arrDateTouched]);

  const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

  // 자동계산: dep/arr 코드가 유효하고 아직 사용자가 손대지 않은 필드만 채운다 (D5).
  useEffect(() => {
    if (!IATA_RE.test(form.dep_iata) || !IATA_RE.test(form.arr_iata)) {
      setEstimating(false);
      return;
    }
    if (distanceTouched && durationTouched) {
      setEstimating(false);
      return;
    }
    const offset = isValidDate(form.date) && isValidDate(form.arr_date) ? diffDays(form.arr_date, form.date) : 0;
    let cancelled = false;
    setEstimating(true);
    api
      .estimate({
        dep: form.dep_iata,
        arr: form.arr_iata,
        date: form.date || undefined,
        dep_time: form.dep_time || undefined,
        arr_time: form.arr_time || undefined,
        offset,
      })
      .then((r) => {
        if (cancelled) return;
        // stale 자동계산 수정: touched가 아닌 필드는 응답이 null이면 값을 유지하지 않고 지운다.
        setForm((f) => ({
          ...f,
          distance_km: distanceTouched ? f.distance_km : r.distance_km != null ? String(r.distance_km) : "",
          duration_text: durationTouched ? f.duration_text : r.duration_min != null ? formatDuration(r.duration_min) : "",
        }));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setEstimating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    form.dep_iata,
    form.arr_iata,
    form.date,
    form.dep_time,
    form.arr_time,
    form.arr_date,
    distanceTouched,
    durationTouched,
  ]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // D24: 편명에서 항공사 코드가 파싱되면 항공사를 그 코드로 맞춘다 (FM 동작).
  // 편명을 나중에 고쳐도 계속 따라가야 하므로 "항공사가 비어 있을 때만"이 아니라
  // "사람이 항공사를 직접 건드리지 않았다면" 매번 반영한다. 불러온 직후(같은 코드)는 건너뛴다.
  const flightNoCode = useMemo(() => extractFlightNoCode(form.flight_no), [form.flight_no]);
  useEffect(() => {
    if (!flightNoCode) return;
    if (airlineTouched) return;
    if (flightNoCode === loadedFlightNoCodeRef.current) return;
    let cancelled = false;
    api
      .airlines.search(flightNoCode)
      .then((rows) => {
        if (cancelled) return;
        const exact = rows.find((r) => r.iata.toUpperCase() === flightNoCode);
        if (exact) {
          set("airline", exact.iata);
          setAirlineResolved(exact);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // form.airline은 이 effect가 쓰는 값이 아니라 쓰는 대상이라 의존성에서 제외 (재실행 낭비 방지)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flightNoCode, airlineTouched]);

  const swap = () => {
    setForm((f) => ({ ...f, dep_iata: f.arr_iata, arr_iata: f.dep_iata }));
    setDepAirport(arrAirport);
    setArrAirport(depAirport);
  };

  const durationPreview = useMemo(() => {
    if (!form.duration_text.trim()) return null;
    return parseDurationToMinutes(form.duration_text);
  }, [form.duration_text]);
  const durationInvalid = form.duration_text.trim() !== "" && durationPreview == null;
  const distanceDisplay = kmToDisplay(form.distance_km);

  const validate = (): Record<string, string> => {
    const next: Record<string, string> = {};
    if (!IATA_RE.test(form.dep_iata)) next.dep_iata = t("form.iataError");
    if (!IATA_RE.test(form.arr_iata)) next.arr_iata = t("form.iataError");
    if (!isValidDate(form.date)) next.date = t("form.dateError");
    if (form.dep_time && !/^\d{2}:\d{2}$/.test(form.dep_time)) next.dep_time = t("form.timeError");
    if (form.arr_time && !/^\d{2}:\d{2}$/.test(form.arr_time)) next.arr_time = t("form.timeError");
    if (!isValidDate(form.arr_date)) next.arr_date = t("form.arrDateError");
    if (durationInvalid) next.duration_text = t("form.durationError");
    if (form.distance_km.trim() && !Number.isFinite(Number(form.distance_km))) {
      next.distance_km = t("form.distanceError");
    }
    // D24: 편명 코드와 resolved 항공사의 iata가 둘 다 있고 다르면 저장 차단 (클라이언트 사전 검증 — 서버가 최종 권위).
    if (flightNoCode && airlineResolved?.iata && flightNoCode !== airlineResolved.iata.toUpperCase()) {
      next.airline = t("form.airlineMismatchError", {
        flightNo: form.flight_no.trim().toUpperCase(),
        airlineName: airlineResolved.name,
        airlineIata: airlineResolved.iata,
      });
    }
    return next;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length > 0) {
      if (v.airline) airlineInputRef.current?.focus();
      return;
    }

    const payload: FlightInput = {
      date: form.date,
      dep_iata: form.dep_iata.toUpperCase(),
      arr_iata: form.arr_iata.toUpperCase(),
      dep_time: form.dep_time || null,
      arr_time: form.arr_time || null,
      arr_day_offset: diffDays(form.arr_date, form.date),
      distance_km: form.distance_km.trim() ? Math.round(Number(form.distance_km)) : null,
      duration_min: durationPreview,
      airline: airlineResolved ? airlineResolved.name : form.airline || null,
      flight_no: form.flight_no || null,
      aircraft_type: form.aircraft_type || null,
      aircraft_reg: form.aircraft_reg || null,
      aircraft_name: form.aircraft_name || null,
      seat: form.seat || null,
      seat_pos: (form.seat_pos || null) as FlightInput["seat_pos"],
      travel_class: (form.travel_class || null) as FlightInput["travel_class"],
      flight_role: (form.flight_role || "passenger") as FlightInput["flight_role"],
      flight_reason: (form.flight_reason || null) as FlightInput["flight_reason"],
      comment: form.comment || null,
    };
    if (depAirport && depAirport.iata === form.dep_iata.toUpperCase()) {
      payload.dep_city = depAirport.city;
      payload.dep_country = depAirport.country;
      payload.dep_airport_name = depAirport.name;
    }
    if (arrAirport && arrAirport.iata === form.arr_iata.toUpperCase()) {
      payload.arr_city = arrAirport.city;
      payload.arr_country = arrAirport.country;
      payload.arr_airport_name = arrAirport.name;
    }

    setSaving(true);
    setSubmitError(null);
    try {
      if (editingId != null) {
        await api.flights.update(editingId, payload);
      } else {
        await api.flights.create(payload);
      }
      navigate("/flights");
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <p className="text-sm text-slate-400">{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <h1 className="text-xl font-semibold text-navy-900">
        {editingId != null ? t("form.editTitle") : t("form.newTitle")}
      </h1>

      {submitError && (
        <Card className="border-red-200 bg-red-50 text-sm text-red-600">{t("form.saveError", { error: submitError })}</Card>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <h2 className="mb-4 text-sm font-semibold text-slate-500">{t("form.sectionRoute")}</h2>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <AirportInput
                label={t("form.depLabel")}
                value={form.dep_iata}
                onChange={(v) => set("dep_iata", v)}
                resolved={depAirport}
                onResolve={setDepAirport}
                error={errors.dep_iata}
              />
            </div>
            <button
              type="button"
              onClick={swap}
              className="mb-8 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:border-navy-600 hover:text-navy-800"
              aria-label={t("form.swapAria")}
            >
              <SwapIcon size={18} />
            </button>
            <div className="flex-1">
              <AirportInput
                label={t("form.arrLabel")}
                value={form.arr_iata}
                onChange={(v) => set("arr_iata", v)}
                resolved={arrAirport}
                onResolve={setArrAirport}
                error={errors.arr_iata}
              />
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-semibold text-slate-500">{t("form.sectionDateTime")}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label={t("form.depDateLabel")} error={errors.date}>
              <input
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
                className={inputCls(!!errors.date)}
              />
            </Field>
            <TimeInput
              label={t("form.depTimeLabel")}
              value={form.dep_time}
              onChange={(v) => set("dep_time", v)}
              error={errors.dep_time}
              format={timeFormat}
            />
            <TimeInput
              label={t("form.arrTimeLabel")}
              value={form.arr_time}
              onChange={(v) => set("arr_time", v)}
              error={errors.arr_time}
              format={timeFormat}
            />
            <Field label={t("form.arrDateLabel")} error={errors.arr_date}>
              <input
                type="date"
                value={form.arr_date}
                onChange={(e) => {
                  setArrDateTouched(true);
                  set("arr_date", e.target.value);
                }}
                className={inputCls(!!errors.arr_date)}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-semibold text-slate-500">{t("form.sectionAutoCalc")}</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">
                {t("form.distanceLabel", { unit: distanceUnit })}
              </label>
              <input
                type="number"
                value={distanceDisplay}
                onChange={(e) => {
                  setDistanceTouched(true);
                  set("distance_km", displayToKm(e.target.value));
                }}
                className={inputCls(!!errors.distance_km)}
              />
              {errors.distance_km ? (
                <p className="mt-1 text-xs text-red-600">{errors.distance_km}</p>
              ) : estimating && !distanceTouched ? (
                <p className="mt-1 text-xs text-slate-400">{t("form.calculating")}</p>
              ) : distanceTouched ? (
                <button
                  type="button"
                  onClick={() => setDistanceTouched(false)}
                  className="mt-1 text-xs text-navy-600 hover:underline"
                >
                  {t("form.recalculate")}
                </button>
              ) : form.distance_km.trim() ? (
                <p className="mt-1 text-xs text-slate-400">{t("form.autoCalculated")}</p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">{t("form.durationLabel")}</label>
              <input
                type="text"
                placeholder={t("form.durationPlaceholder")}
                value={form.duration_text}
                onChange={(e) => {
                  setDurationTouched(true);
                  set("duration_text", e.target.value);
                }}
                className={inputCls(!!errors.duration_text)}
              />
              {errors.duration_text ? (
                <p className="mt-1 text-xs text-red-600">{errors.duration_text}</p>
              ) : estimating && !durationTouched ? (
                <p className="mt-1 text-xs text-slate-400">{t("form.calculating")}</p>
              ) : durationTouched ? (
                <button
                  type="button"
                  onClick={() => setDurationTouched(false)}
                  className="mt-1 text-xs text-navy-600 hover:underline"
                >
                  {t("form.recalculate")}
                </button>
              ) : form.duration_text.trim() ? (
                <p className="mt-1 text-xs text-slate-400">{t("form.autoCalculated")}</p>
              ) : !form.dep_time || !form.arr_time ? (
                <p className="mt-1 text-xs text-slate-300">{t("form.durationHint")}</p>
              ) : null}
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-semibold text-slate-500">{t("form.sectionFlightInfo")}</h2>
          <div className="grid grid-cols-2 gap-4">
            {/* 편명을 먼저 — 편명을 넣으면 항공사가 자동으로 채워지는 흐름(FM 동작)이 자연스럽도록 */}
            <Field label={t("form.flightNoLabel")} help={t("form.flightNoHelp")}>
              <input
                type="text"
                value={form.flight_no}
                onChange={(e) => set("flight_no", e.target.value.toUpperCase())}
                onBlur={() => {
                  if (form.flight_no.trim()) set("flight_no", previewNormalizeFlightNo(form.flight_no));
                }}
                placeholder={t("form.flightNoPlaceholder")}
                className={inputCls(false)}
              />
            </Field>
            <AirlineInput
              ref={airlineInputRef}
              label={t("form.airlineLabel")}
              value={form.airline}
              onChange={(v) => {
                setAirlineTouched(true);
                set("airline", v);
              }}
              resolved={airlineResolved}
              onResolve={setAirlineResolved}
              error={errors.airline}
            />
            <TextAutocomplete
              label={t("form.aircraftTypeLabel")}
              value={form.aircraft_type}
              onChange={(v) => set("aircraft_type", v)}
              options={suggest.aircraftTypes}
              placeholder={t("form.aircraftTypePlaceholder")}
            />
            <TextAutocomplete
              label={t("form.registrationLabel")}
              value={form.aircraft_reg}
              onChange={(v) => set("aircraft_reg", v)}
              options={suggest.registrations}
              placeholder={t("form.registrationPlaceholder")}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <Field label={t("form.seatLabel")}>
              <input
                type="text"
                value={form.seat}
                onChange={(e) => set("seat", e.target.value)}
                placeholder={t("form.seatPlaceholder")}
                className={inputCls(false)}
              />
            </Field>
            <Field label={t("form.aircraftNameLabel")}>
              <input
                type="text"
                value={form.aircraft_name}
                onChange={(e) => set("aircraft_name", e.target.value)}
                placeholder={t("form.optionalPlaceholder")}
                className={inputCls(false)}
              />
            </Field>
          </div>

          <div className="mt-4 space-y-4">
            <RadioGroup
              label={t("form.seatPosLabel")}
              value={form.seat_pos}
              onChange={(v) => set("seat_pos", v)}
              options={[
                { value: "", label: t("common.unspecified") },
                { value: "window", label: t("common.seatWindow") },
                { value: "aisle", label: t("common.seatAisle") },
                { value: "middle", label: t("common.seatMiddle") },
              ]}
            />
            <RadioGroup
              label={t("form.classLabel")}
              value={form.travel_class}
              onChange={(v) => set("travel_class", v)}
              options={[
                { value: "", label: t("common.unspecified") },
                { value: "economy", label: t("common.classEconomy") },
                { value: "economyplus", label: t("common.classEconomyPlus") },
                { value: "business", label: t("common.classBusiness") },
                { value: "first", label: t("common.classFirst") },
              ]}
            />
            <RadioGroup
              label={t("form.roleLabel")}
              value={form.flight_role}
              onChange={(v) => set("flight_role", v)}
              options={[
                { value: "passenger", label: t("common.rolePassenger") },
                { value: "crew", label: t("common.roleCrew") },
                { value: "cockpit", label: t("common.roleCockpit") },
              ]}
            />
            <RadioGroup
              label={t("form.reasonLabel")}
              value={form.flight_reason}
              onChange={(v) => set("flight_reason", v)}
              options={[
                { value: "personal", label: t("common.reasonPersonal") },
                { value: "business", label: t("common.reasonBusiness") },
                { value: "virtual", label: t("common.reasonVirtual") },
              ]}
            />
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-xs font-medium text-slate-500">{t("form.commentLabel")}</label>
            <textarea
              value={form.comment}
              onChange={(e) => set("comment", e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-navy-900 focus:border-navy-600 focus:outline-none"
            />
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate("/flights")}
            className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            {t("form.cancel")}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-navy-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
          >
            {saving ? t("form.saving") : editingId != null ? t("form.updateSubmit") : t("form.createSubmit")}
          </button>
        </div>
      </form>
    </div>
  );
}

function inputCls(hasError: boolean): string {
  return `w-full rounded-xl border px-3 py-2 text-sm text-navy-900 focus:outline-none ${
    hasError ? "border-red-400" : "border-slate-200 focus:border-navy-600"
  }`;
}

function Field({
  label,
  error,
  help,
  children,
}: {
  label: string;
  error?: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-red-600">{error}</p>
      ) : help ? (
        <p className="mt-1 text-xs text-slate-300">{help}</p>
      ) : null}
    </div>
  );
}
