import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
// world-atlas 배포 JSON은 타입 선언이 없다 — any 캐스팅 허용(CLAUDE.md 지침).
// @ts-ignore
import worldTopo from "world-atlas/countries-110m.json";
import { api, type MapResult } from "../lib/api";
import { useI18n } from "../i18n";

const WIDTH = 960;
const HEIGHT = 460;

// 태평양 중심 투영: 한국이 중앙 근처, 미주가 우측에 오도록 rotate.
const land = feature(worldTopo as any, (worldTopo as any).objects.land) as any;
const projection = geoNaturalEarth1().rotate([-155, 0]).fitSize([WIDTH, HEIGHT], land);
const pathGen = geoPath(projection);
const LAND_PATH = pathGen(land) ?? "";

interface WorldMapProps {
  year?: string | null;
  /** true면 카드 안 제목/여백 없이 SVG만 렌더 */
  className?: string;
}

interface ArcRender {
  key: string;
  d: string;
  count: number;
}

interface PointRender {
  iata: string;
  city: string | null;
  count: number;
  x: number;
  y: number;
}

type Anchor = "start" | "end" | "middle";

interface LabelRender {
  iata: string;
  x: number;
  y: number;
  anchor: Anchor;
  /** 점에서 멀리 떨어뜨린 라벨은 어느 점의 것인지 선으로 잇는다 */
  leader: { x1: number; y1: number } | null;
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const LABEL_W = 24; // IATA 3글자 @ 11px semibold ≈ 22px + 여유
const LABEL_H = 11;

const MIN_ZOOM = 1;
const MAX_ZOOM = 12;

// 가까운 자리부터 시도하고, 밀집 지역(한국·일본권)에서는 점점 먼 자리로 밀려난다.
const LABEL_OFFSETS: { dx: number; dy: number; anchor: Anchor }[] = [
  ...[6, 18, 32, 46].flatMap((d) => [
    { dx: d, dy: -4, anchor: "start" as Anchor },
    { dx: -d, dy: -4, anchor: "end" as Anchor },
    { dx: d, dy: 12, anchor: "start" as Anchor },
    { dx: -d, dy: 12, anchor: "end" as Anchor },
    { dx: d, dy: -16, anchor: "start" as Anchor },
    { dx: -d, dy: -16, anchor: "end" as Anchor },
    { dx: d, dy: 24, anchor: "start" as Anchor },
    { dx: -d, dy: 24, anchor: "end" as Anchor },
  ]),
  { dx: 0, dy: -9, anchor: "middle" },
  { dx: 0, dy: 17, anchor: "middle" },
  { dx: 0, dy: -20, anchor: "middle" },
  { dx: 0, dy: 27, anchor: "middle" },
];

/** 앵커에 따라 라벨이 실제로 차지하는 사각형. 확대(k) 시에도 화면상 크기가 같도록 1/k 적용. */
function labelBox(x: number, y: number, anchor: Anchor, k: number): Box {
  const w = LABEL_W / k;
  const h = LABEL_H / k;
  const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
  return { x0, x1: x0 + w, y0: y - h, y1: y + 2 / k };
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * 모든 공항에 라벨을 붙인다. count 많은 쪽이 좋은 자리를 먼저 차지하고,
 * 겹치면 다음 후보로 밀린다. 점에서 멀어진 라벨에는 리더 라인을 그린다.
 * 후보가 전부 막히면 생략하지 않고 "겹침이 가장 적은 자리"에 배치한다
 * — 라벨이 사라지는 것보다 조금 겹치더라도 보이는 편이 낫다.
 */
function placeLabels(candidates: PointRender[], k: number): LabelRender[] {
  const placedBoxes: Box[] = [];
  const result: LabelRender[] = [];
  const sorted = [...candidates].sort((a, b) => b.count - a.count);

  for (const p of sorted) {
    let best: { dx: number; dy: number; anchor: Anchor; box: Box; cost: number } | null = null;

    for (const raw of LABEL_OFFSETS) {
      // 오프셋도 화면 기준으로 일정하게 — 확대할수록 월드 좌표상 간격은 좁아진다
      const dx = raw.dx / k;
      const dy = raw.dy / k;
      const box = labelBox(p.x + dx, p.y + dy, raw.anchor, k);
      let cost = placedBoxes.reduce((s, b) => s + overlapArea(box, b), 0);
      // 다른 공항 점을 라벨로 덮으면 비용 가산
      for (const o of candidates) {
        if (o.iata === p.iata) continue;
        if (o.x > box.x0 - 2 / k && o.x < box.x1 + 2 / k && o.y > box.y0 && o.y < box.y1) {
          cost += 40 / (k * k);
        }
      }
      if (cost === 0) {
        best = { dx, dy, anchor: raw.anchor, box, cost };
        break; // 깨끗한 자리를 찾으면 즉시 채택
      }
      // 가까운 후보를 선호하도록 거리에 약한 페널티
      const scored = cost + Math.hypot(dx, dy) * 0.5;
      if (!best || scored < best.cost) best = { dx, dy, anchor: raw.anchor, box, cost: scored };
    }

    if (!best) continue;
    placedBoxes.push(best.box);
    const far = Math.abs(best.dx * k) > 10 || Math.abs(best.dy * k) > 18;
    result.push({
      iata: p.iata,
      x: p.x + best.dx,
      y: p.y + best.dy,
      anchor: best.anchor,
      leader: far ? { x1: p.x, y1: p.y } : null,
    });
  }
  return result;
}

interface View {
  k: number;
  tx: number;
  ty: number;
}

const IDENTITY: View = { k: 1, tx: 0, ty: 0 };

/** 확대된 지도가 뷰포트 밖으로 빠져나가지 않도록 이동량을 제한 */
function clampView(v: View): View {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k));
  return {
    k,
    tx: Math.min(0, Math.max(WIDTH * (1 - k), v.tx)),
    ty: Math.min(0, Math.max(HEIGHT * (1 - k), v.ty)),
  };
}

/** 화면상의 한 점(px, py)을 고정한 채 배율만 바꾼다 */
function zoomAt(v: View, nextK: number, px: number, py: number): View {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextK));
  const ratio = k / v.k;
  return clampView({ k, tx: px - (px - v.tx) * ratio, ty: py - (py - v.ty) * ratio });
}

export default function WorldMap({ year = null, className }: WorldMapProps) {
  const { t } = useI18n();
  const [data, setData] = useState<MapResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(IDENTITY);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const focusRef = useRef<{ px: number; py: number } | null>(null);

  /** 마우스 좌표 → SVG viewBox 좌표 (반응형이라 실제 폭으로 환산) */
  const toSvg = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { px: WIDTH / 2, py: HEIGHT / 2 };
    return {
      px: ((clientX - rect.left) / rect.width) * WIDTH,
      py: ((clientY - rect.top) / rect.height) * HEIGHT,
    };
  }, []);

  // 휠 줌 — 페이지 스크롤을 막아야 해서 passive:false 네이티브 리스너로 등록
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { px, py } = toSvg(e.clientX, e.clientY);
      setView((v) => zoomAt(v, v.k * Math.pow(1.0015, -e.deltaY), px, py));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [toSvg]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (view.k <= MIN_ZOOM) return; // 축소 상태에선 이동할 여지가 없다
    // 캡처 실패가 드래그 자체를 막지 않도록 (캡처는 편의 기능일 뿐)
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 무시 */
    }
    dragRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = WIDTH / rect.width;
    setView((v) =>
      clampView({ ...v, tx: d.tx + (e.clientX - d.x) * scale, ty: d.ty + (e.clientY - d.y) * scale }),
    );
  };

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 무시 */
    }
    dragRef.current = null;
    setDragging(false);
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const { px, py } = toSvg(e.clientX, e.clientY);
    setView((v) => zoomAt(v, v.k * 2, px, py));
  };

  /**
   * 버튼 줌. 전체 보기(k=1)에서 확대하면 홈 공항(최다 이용)을 화면 중앙으로 데려오고,
   * 이미 확대 중이면 지금 보고 있는 화면 중앙을 유지한 채 배율만 바꾼다.
   */
  const zoomButton = (factor: number) =>
    setView((v) => {
      const home = focusRef.current;
      if (v.k <= MIN_ZOOM && home) {
        const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
        return clampView({ k, tx: WIDTH / 2 - home.px * k, ty: HEIGHT / 2 - home.py * k });
      }
      return zoomAt(v, v.k * factor, WIDTH / 2, HEIGHT / 2);
    });

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .map(year)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [year]);

  const { arcs, points, labels, home } = useMemo(() => {
    if (!data) {
      return {
        arcs: [] as ArcRender[],
        points: [] as PointRender[],
        labels: [] as LabelRender[],
        home: null as PointRender | null,
      };
    }
    const byIata = new Map(data.airports.map((a) => [a.iata, a]));

    const arcs: ArcRender[] = [];
    for (const arc of data.arcs) {
      const from = byIata.get(arc.from);
      const to = byIata.get(arc.to);
      if (!from || !to) continue;
      const line = {
        type: "LineString" as const,
        coordinates: [
          [from.lon, from.lat],
          [to.lon, to.lat],
        ],
      };
      const d = pathGen(line as any);
      if (d) arcs.push({ key: `${arc.from}-${arc.to}`, d, count: arc.count });
    }

    const points: PointRender[] = [];
    for (const a of data.airports) {
      const coord = projection([a.lon, a.lat]);
      if (!coord) continue;
      points.push({ iata: a.iata, city: a.city, count: a.count, x: coord[0], y: coord[1] });
    }

    // 모든 공항에 라벨을 단다. 확대 수준(k)에 맞춰 재배치하므로,
    // 확대하면 뭉쳐 있던 라벨이 제자리를 찾아 풀린다.
    const labels = placeLabels(points, view.k);

    // 버튼 확대의 기준점 = 가장 많이 이용한 공항(사실상 홈베이스).
    // 가중 평균을 쓰면 편수가 적은 장거리 노선에 끌려가 정작 주 활동 지역이 화면 밖으로 나간다.
    const home = points.reduce<PointRender | null>(
      (best, p) => (best == null || p.count > best.count ? p : best),
      null,
    );

    return { arcs, points, labels, home };
  }, [data, view.k]);

  // ref 대입은 렌더 중 side effect라 useMemo 밖(effect)에서 해야 StrictMode/동시성 렌더에서 안전하다.
  useEffect(() => {
    focusRef.current = home ? { px: home.x, py: home.y } : null;
  }, [home]);

  const maxArcCount = Math.max(1, ...arcs.map((a) => a.count));
  const maxPointCount = Math.max(1, ...points.map((p) => p.count));

  // 확대해도 선·점·글자는 화면상 같은 크기로 보이도록 1/k 보정
  const k = view.k;
  const zoomed = k > MIN_ZOOM;

  return (
    <div className={`relative ${className ?? "w-full"}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full touch-none select-none"
        style={{ cursor: dragging ? "grabbing" : zoomed ? "grab" : "default" }}
        role="img"
        aria-label={t("common.mapAriaLabel")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
      >
        <g transform={`translate(${view.tx},${view.ty}) scale(${k})`}>
          <path d={LAND_PATH} fill="#dbe9f8" stroke="#b5d4f4" strokeWidth={0.75 / k} />
          {arcs.map((arc) => (
            <path
              key={arc.key}
              d={arc.d}
              fill="none"
              stroke="#185fa5"
              strokeWidth={(1 + (arc.count / maxArcCount) * 1.5) / k}
              strokeOpacity={0.55}
              strokeLinecap="round"
            />
          ))}
          {points.map((p) => (
            <circle
              key={p.iata}
              cx={p.x}
              cy={p.y}
              r={(2 + (p.count / maxPointCount) * 2) / k}
              fill="#0c447c"
            />
          ))}
          {labels.map(
            (l) =>
              l.leader && (
                <line
                  key={`leader-${l.iata}`}
                  x1={l.leader.x1}
                  y1={l.leader.y1}
                  x2={l.anchor === "end" ? l.x - 1 / k : l.anchor === "start" ? l.x + 1 / k : l.x}
                  y2={l.y - 3 / k}
                  stroke="#7d9cbd"
                  strokeWidth={0.6 / k}
                />
              ),
          )}
          {labels.map((l) => (
            <text
              key={`label-${l.iata}`}
              x={l.x}
              y={l.y}
              textAnchor={l.anchor}
              fontSize={11 / k}
              fontWeight={600}
              fill="#042c53"
              stroke="white"
              strokeWidth={3 / k}
              paintOrder="stroke"
            >
              {l.iata}
            </text>
          ))}
        </g>
      </svg>

      <div className="absolute right-3 top-3 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => zoomButton(1.6)}
          aria-label={t("common.mapZoomIn")}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white/90 text-lg leading-none text-navy-800 hover:bg-sky-100"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => zoomButton(1 / 1.6)}
          aria-label={t("common.mapZoomOut")}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white/90 text-lg leading-none text-navy-800 hover:bg-sky-100"
        >
          −
        </button>
        {zoomed && (
          <button
            type="button"
            onClick={() => setView(IDENTITY)}
            aria-label={t("common.mapResetZoomAria")}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white/90 text-[10px] leading-none text-navy-800 hover:bg-sky-100"
          >
            {t("common.mapResetZoom")}
          </button>
        )}
      </div>

      {zoomed && (
        <span className="absolute right-14 top-3 rounded-md bg-white/85 px-2 py-1 text-[11px] leading-none text-slate-500">
          {t("common.mapZoomedHint", { k: k.toFixed(1) })}
        </span>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{t("common.mapLoadError", { error })}</p>}
      {!data && !error && <p className="mt-2 text-sm text-slate-400">{t("common.mapLoading")}</p>}
    </div>
  );
}
