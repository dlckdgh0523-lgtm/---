'use client';

/**
 * /places — 접점 지도 (카카오맵 JavaScript SDK + MarkerClusterer).
 * - 키: NEXT_PUBLIC_KAKAO_MAP_KEY (.env.local). 키가 없으면 지도만 비활성 안내하고
 *   필터·리스트·상세 패널은 그대로 동작한다 (동작하지 않는 화면 금지 원칙).
 * - 7,113건을 그대로 찍지 않는다 — 클러스터러 사용, 필터는 마커에 즉시 반영.
 * - 핀 클릭 → 상세 패널 (데스크톱 우측 / 모바일 바텀시트). 건축물대장은 온디맨드 + 캐시.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from 'react';
import Script from 'next/script';
import Link from 'next/link';
import { useAccount } from '@/lib/account';
import { regionLabel } from '@/data/regions';
import { fetchRegionRegistry, findPack } from '@/lib/region-registry';
import { needsFor } from '@/data/needs-map';
import { anniversaryOf, GROUPS, toViews, type MarkerGroup } from '@/lib/place-view';
import type { ScenarioLookup } from '@/lib/llm/types';
import type { BuildingLookup, Place } from '@/types';

declare global {
  interface Window {
    kakao: any;
  }
}

const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

function pinSvg(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="7" fill="${color}" stroke="white" stroke-width="2"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

interface CondStat {
  survival: number;
  ciLow: number;
  ciHigh: number;
  atRisk: number;
  reliable: boolean;
}
interface SurvivalLite {
  cond24at6: { byCategory: Record<string, CondStat> };
  byCategory: Record<string, { surv: number[] }>;
}

const survKey = (cat: string) => (cat.startsWith('골프') ? '골프시설' : cat);

/** 업종 폐업 집중 구간: 월당 폐업률이 가장 높은 존속 구간 */
function peakClosureBucket(surv: number[] | undefined): string | null {
  if (!surv) return null;
  const buckets: [number, number, string][] = [
    [0, 2, '0~2개월'],
    [3, 6, '3~6개월'],
    [7, 12, '7~12개월'],
    [13, 24, '13~24개월'],
    [25, 36, '25~36개월'],
    [37, 60, '37~60개월'],
  ];
  let best: { label: string; rate: number } | null = null;
  for (const [a, b, label] of buckets) {
    const s0 = a === 0 ? 1 : surv[a - 1];
    const s1 = surv[b];
    if (!s0) continue;
    const perMonth = (1 - s1 / s0) / (b - a + 1);
    if (!best || perMonth > best.rate) best = { label, rate: perMonth };
  }
  return best?.label ?? null;
}

const buildingCache = new Map<string, BuildingLookup>();

export default function PlacesPage() {
  const { status, profile } = useAccount();
  const [regionCode, setRegionCode] = useState<string | null>(null);
  const [packReady, setPackReady] = useState<boolean | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [survival, setSurvival] = useState<SurvivalLite | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [catFilter, setCatFilter] = useState<string>('');
  const [dongFilter, setDongFilter] = useState<string>('');
  const [groupFilter, setGroupFilter] = useState<MarkerGroup | ''>('');
  const [selected, setSelected] = useState<Place | null>(null);
  const [building, setBuilding] = useState<BuildingLookup | null>(null);
  const [scenario, setScenario] = useState<ScenarioLookup | 'loading' | null>(null);

  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const clustererRef = useRef<any>(null);
  const markersRef = useRef<{ marker: any; place: Place; group: MarkerGroup }[]>([]);

  const now = useMemo(() => new Date(), []);

  // 데이터 로드 — 지역은 계정 프로필, 활성 여부는 레지스트리(단일 출처)
  useEffect(() => {
    if (status !== 'ready' || !profile) return;
    setRegionCode(profile.region);
    (async () => {
      const registry = await fetchRegionRegistry();
      if (!findPack(registry, profile.region)) {
        setPackReady(false);
        return;
      }
      const [placesRes, survivalRes] = await Promise.all([
        fetch(`/data/regions/${profile.region}/places.json`),
        fetch(`/data/regions/${profile.region}/survival.json`),
      ]);
      setPlaces((await placesRes.json()) as Place[]);
      if (survivalRes.ok) setSurvival((await survivalRes.json()) as SurvivalLite);
      setPackReady(true);
    })();
  }, [status, profile]);

  const views = useMemo(() => toViews(places, now), [places, now]);

  const cats = useMemo(() => [...new Set(places.map((p) => p.category.large))].sort(), [places]);
  const dongs = useMemo(() => [...new Set(places.map((p) => p.adminDong).filter(Boolean) as string[])].sort(), [places]);

  const filtered = useMemo(
    () =>
      views.filter(
        (v) =>
          (!catFilter || v.place.category.large === catFilter) &&
          (!dongFilter || v.place.adminDong === dongFilter) &&
          (!groupFilter || v.group === groupFilter),
      ),
    [views, catFilter, dongFilter, groupFilter],
  );

  // 지도 초기화 (SDK + 데이터 준비 후 1회)
  useEffect(() => {
    if (!sdkReady || !mapEl.current || mapRef.current || views.length === 0) return;
    const kakao = window.kakao;
    const lat = views.reduce((s, v) => s + v.place.lat, 0) / views.length;
    const lng = views.reduce((s, v) => s + v.place.lng, 0) / views.length;
    const map = new kakao.maps.Map(mapEl.current, { center: new kakao.maps.LatLng(lat, lng), level: 6 });
    const clusterer = new kakao.maps.MarkerClusterer({ map, averageCenter: true, minLevel: 4, gridSize: 80 });
    const images = Object.fromEntries(
      GROUPS.map((g) => [
        g.key,
        new kakao.maps.MarkerImage(pinSvg(g.color), new kakao.maps.Size(18, 18), { offset: new kakao.maps.Point(9, 9) }),
      ]),
    );
    markersRef.current = views.map((v) => {
      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(v.place.lat, v.place.lng),
        image: images[v.group],
        title: v.place.name,
      });
      kakao.maps.event.addListener(marker, 'click', () => setSelected(v.place));
      return { marker, place: v.place, group: v.group };
    });
    mapRef.current = map;
    clustererRef.current = clusterer;
  }, [sdkReady, views]);

  // 필터 → 마커 즉시 반영. sdkReady를 dep에 포함해야 지도 초기화(clusterer 생성) 직후에도 실행된다
  // (filtered만 dep로 두면 clusterer가 생기기 전 1회만 돌고 재실행되지 않아 마커가 영영 안 붙는다).
  useEffect(() => {
    const clusterer = clustererRef.current;
    if (!clusterer) return;
    const ids = new Set(filtered.map((v) => v.place.id));
    clusterer.clear();
    clusterer.addMarkers(markersRef.current.filter((m) => ids.has(m.place.id)).map((m) => m.marker));
  }, [filtered, sdkReady]);

  // 상세 패널 열릴 때 건축물대장 온디맨드 조회 (클라이언트 캐시 + 서버 캐시)
  useEffect(() => {
    setScenario(null); // 다른 사업장 선택 시 시나리오 초기화
    if (!selected || !regionCode) return;
    const cached = buildingCache.get(selected.id);
    if (cached) {
      setBuilding(cached);
      return;
    }
    setBuilding(null);
    fetch(`/api/building?region=${regionCode}&id=${encodeURIComponent(selected.id)}`)
      .then((r) => r.json())
      .then((lookup: BuildingLookup) => {
        buildingCache.set(selected.id, lookup);
        setBuilding(lookup);
      })
      .catch(() => setBuilding({ status: 'error', placeId: selected.id, message: 'network' }));
  }, [selected, regionCode]);

  if (packReady === false) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="font-semibold">{regionCode ? regionLabel(regionCode) : ''}의 접점 데이터가 아직 없습니다</p>
        <p className="mt-2 text-sm text-slate-500">
          이 지역의 데이터 팩이 준비되면 리스트와 지도가 활성화됩니다. 자금 구조 점검은 지역과 무관하게 쓸 수 있습니다.
        </p>
        <Link href="/dashboard" className="mt-4 inline-block rounded-lg bg-[#3182F6] px-5 py-2 text-sm text-white">
          대시보드로 →
        </Link>
      </div>
    );
  }
  if (packReady === null) return null;

  const selectedView = selected ? views.find((v) => v.place.id === selected.id) : null;
  const selectedSurvStat = selected ? survival?.cond24at6.byCategory[survKey(selected.category.large)] : null;
  const selectedPeak = selected ? peakClosureBucket(survival?.byCategory[survKey(selected.category.large)]?.surv) : null;
  const selectedNeeds = selected ? needsFor(survKey(selected.category.large)) : null;

  return (
    <div className="space-y-4">
      {KAKAO_KEY && (
        <Script
          src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false&libraries=clusterer`}
          strategy="afterInteractive"
          onLoad={() => window.kakao.maps.load(() => setSdkReady(true))}
        />
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-bold">{regionCode ? regionLabel(regionCode) : ''} 접점 지도</h1>
        <p className="text-sm text-slate-500">
          오늘 기준 대상 {views.length.toLocaleString()}건 · 필터 적용 {filtered.length.toLocaleString()}건
        </p>
      </div>
      <p className="rounded-2xl bg-[#F9FAFB] px-3 py-2 text-xs leading-relaxed text-slate-500">
        사업주 접점은 <b>매장이 한산할 때</b>가 좋습니다 — 혼잡 시간대 방문은 비권장. 사람이 많은 곳·시간을 찾는
        가두 홍보는{' '}
        <Link href="/outreach" className="text-[#3182F6] underline">홍보 포인트</Link>에서 — 두 기능은 목적이
        반대입니다.
      </p>

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm">
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5">
          <option value="">업종 전체</option>
          {cats.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={dongFilter} onChange={(e) => setDongFilter(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5">
          <option value="">동 전체</option>
          {dongs.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1.5">
          {GROUPS.map((g) => (
            <button
              key={g.key}
              onClick={() => setGroupFilter(groupFilter === g.key ? '' : g.key)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                groupFilter === g.key ? 'border-[#3182F6] bg-[#3182F6] text-white' : 'border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: g.color }} />
              {g.label} ({views.filter((v) => v.group === g.key).length})
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div>
          {KAKAO_KEY ? (
            <div ref={mapEl} className="h-[420px] w-full rounded-2xl border border-slate-200 sm:h-[540px]" />
          ) : (
            <div className="flex h-[420px] items-center justify-center rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-8 text-center text-sm text-amber-800 sm:h-[540px]">
              카카오맵 키(NEXT_PUBLIC_KAKAO_MAP_KEY) 대기 중 — 키가 들어오면 지도가 활성화됩니다.
              <br />
              아래 리스트와 상세 패널은 지금도 동작합니다.
            </div>
          )}

          {/* 리스트 (지도 보조 — 필터 공유) */}
          <ul className="mt-3 max-h-72 space-y-1.5 overflow-y-auto">
            {filtered.slice(0, 80).map((v) => (
              <li key={v.place.id}>
                <button
                  onClick={() => setSelected(v.place)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition hover:bg-slate-50 ${
                    selected?.id === v.place.id ? 'border-[#3182F6]' : 'border-slate-200'
                  }`}
                >
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: GROUPS.find((g) => g.key === v.group)!.color }}
                  />
                  <b>{v.place.name}</b>{' '}
                  <span className="text-xs text-slate-400">
                    {v.place.category.large} · {v.place.adminDong ?? ''} · {v.elapsed}개월 ({v.stage.label})
                  </span>
                </button>
              </li>
            ))}
            {filtered.length > 80 && (
              <li className="py-1 text-center text-xs text-slate-400">외 {filtered.length - 80}건 — 지도 또는 필터로 좁혀보세요</li>
            )}
          </ul>
        </div>

        {/* 상세 패널: 데스크톱 우측 / 모바일 바텀시트 */}
        {selected && selectedView && (
          <aside className="fixed inset-x-0 bottom-0 z-40 max-h-[62vh] overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-2xl lg:static lg:max-h-none lg:rounded-2xl lg:shadow-none">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-bold">{selected.name}</h2>
                <p className="text-xs text-slate-500">
                  {selected.category.large}
                  {selected.category.medium ? ` · ${selected.category.medium}` : ''}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>

            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-slate-400">주소</dt>
                <dd className="text-right">{selected.address}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">인허가일</dt>
                <dd>{selected.licenseDate}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">경과</dt>
                <dd>
                  {selectedView.elapsed}개월 · {selectedView.stage.label}
                  {selectedView.elapsed >= 11 && ` · ${anniversaryOf(selectedView.elapsed)}주년${[11, 0, 1].includes(selectedView.elapsed % 12) ? ' 도래' : ''}`}
                </dd>
              </div>
            </dl>

            {selected.suspectedRelicense && (
              <div className="mt-3 rounded-lg bg-red-50 p-3 text-xs leading-relaxed text-red-800">
                <b>업종 전환·재인허가 의심</b> — 같은 자리에서 유사 상호 "{selected.suspectedRelicense.prevName}"(
                {selected.suspectedRelicense.prevCategory})가 {selected.suspectedRelicense.prevClosedAt}에 폐업한 직후
                재인허가됐습니다. 신규 개업이 아닐 수 있습니다.
              </div>
            )}

            {/* 업종 존속 요약 (생존 분석 연동 + 표본 규칙 적용) */}
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
              <p className="font-semibold text-slate-700">이 업종의 존속 데이터</p>
              {selectedSurvStat ? (
                selectedSurvStat.reliable ? (
                  <p className="mt-0.5">
                    {survKey(selected.category.large)}은 개업 6개월 시점 기준 <b>24개월 내 폐업률 {((1 - selectedSurvStat.survival) * 100).toFixed(1)}%</b>
                    {' '}(95% CI {((1 - selectedSurvStat.ciHigh) * 100).toFixed(1)}~{((1 - selectedSurvStat.ciLow) * 100).toFixed(1)}%, n={selectedSurvStat.atRisk.toLocaleString()})
                    {selectedPeak && <> · 폐업은 존속 {selectedPeak} 구간에 상대적으로 집중</>}
                  </p>
                ) : (
                  <p className="mt-0.5 text-amber-700">표본 부족(n={selectedSurvStat.atRisk}) — 이 업종의 수치는 표시하지 않습니다.</p>
                )
              ) : (
                <p className="mt-0.5">이 지역의 존속 분석 데이터가 없습니다.</p>
              )}
            </div>

            {/* 건축 정보 — 온디맨드, 실패해도 패널 유지 */}
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-semibold text-slate-700">건축물대장 (표제부)</p>
              {!building && <p className="mt-0.5 text-slate-400">조회 중…</p>}
              {building?.status === 'ok' && (
                <ul className="mt-0.5 space-y-0.5">
                  <li>주구조 {building.data.mainStructure ?? '—'} · 지붕 {building.data.roofStructure ?? '—'}</li>
                  <li>
                    연면적 {building.data.totalFloorArea != null ? `${building.data.totalFloorArea.toLocaleString()}㎡` : '—'} · 지상{' '}
                    {building.data.floorsAbove ?? '—'}층 / 지하 {building.data.floorsBelow ?? '—'}층
                  </li>
                  <li>
                    주용도 {building.data.mainUse ?? '—'} · 사용승인 {building.data.approvalDate ?? '—'} · 내진설계{' '}
                    {building.data.earthquakeResistant === null ? '—' : building.data.earthquakeResistant ? '적용' : '미적용'}
                  </li>
                </ul>
              )}
              {building?.status === 'not_found' && <p className="mt-0.5 text-slate-400">이 번지의 건축물대장을 찾지 못했습니다.</p>}
              {building?.status === 'error' && <p className="mt-0.5 text-slate-400">조회 실패 — 잠시 후 다시 열어보세요.</p>}
              {building?.status === 'disabled' && <p className="mt-0.5 text-slate-400">건축물대장 API 키가 설정되지 않았습니다.</p>}
            </div>

            {/* 음성 롤플레잉 진입 — 이 사업장 데이터로 페르소나 구성 */}
            <Link
              href={`/roleplay?region=${regionCode}&place=${encodeURIComponent(selected.id)}`}
              className="mt-3 block rounded-lg bg-[#191F28] p-3 text-center text-sm font-bold text-white transition hover:bg-[#333B48]"
            >
              🎤 이 사장님과 방문 상담 연습 (음성 롤플레잉)
            </Link>

            {/* 접근 시나리오 생성 (LLM 용도 1) — 숫자·법령은 코드가 통제, LLM은 문장만 */}
            <div className="mt-3 rounded-lg bg-[#E8F3FF] p-3 text-xs">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-[#191F28]">첫 접근 멘트 (AI)</p>
                {scenario === null && (
                  <button
                    onClick={async () => {
                      setScenario('loading');
                      try {
                        const res = await fetch('/api/llm/scenario', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ region: regionCode, placeId: selected.id }),
                        });
                        setScenario((await res.json()) as ScenarioLookup);
                      } catch {
                        setScenario({ status: 'error', message: '네트워크 오류' });
                      }
                    }}
                    className="rounded-full bg-[#3182F6] px-3 py-1 font-semibold text-white hover:bg-[#1B64DA]"
                  >
                    3개 각도로 생성
                  </button>
                )}
              </div>
              {scenario === 'loading' && <p className="mt-1.5 text-slate-500">이 사업장의 맥락으로 만드는 중…</p>}
              {scenario && scenario !== 'loading' && scenario.status === 'disabled' && (
                <p className="mt-1.5 text-slate-500">ANTHROPIC_API_KEY 대기 중 — 키가 들어오면 활성화됩니다.</p>
              )}
              {scenario && scenario !== 'loading' && scenario.status === 'error' && (
                <p className="mt-1.5 text-red-600">{scenario.message}</p>
              )}
              {scenario && scenario !== 'loading' && scenario.status === 'ok' && (
                <div className="mt-1.5 space-y-2">
                  {scenario.scenarios.map((s) => (
                    <div key={s.angle} className="rounded-lg bg-white p-2.5">
                      <p className="font-semibold text-[#3182F6]">{s.angle}</p>
                      <p className="mt-0.5 leading-relaxed text-slate-700">{s.text}</p>
                    </div>
                  ))}
                  <p className="text-[10px] text-slate-400">{scenario.note}</p>
                </div>
              )}
            </div>

            {/* 추정 보장 니즈 — 사업/개인 분리 (상품 구조 재정의) */}
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-semibold text-slate-700">추정 보장 니즈</p>
              {selectedNeeds && (selectedNeeds.business.length > 0 || selectedNeeds.personalContext.length > 0) ? (
                <div className="mt-1 space-y-1.5">
                  <div>
                    <p className="text-slate-400">사업 보장 (진입 명분)</p>
                    <p>{selectedNeeds.business.map((n) => n.label).join(', ') || '—'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">개인 보장 진입 맥락</p>
                    <p>{selectedNeeds.personalContext.map((n) => n.label).join(', ') || '—'}</p>
                  </div>
                </div>
              ) : (
                <p className="mt-0.5 text-slate-400">업종별 매핑 준비 중 — 보험 실무 검토 후 채워집니다 (추측으로 채우지 않음).</p>
              )}
            </div>
          </aside>
        )}
      </div>

      <p className="text-xs text-slate-400">
        이 데이터는 사업장 단위 공개 정보이며 개인 신원 정보를 포함하지 않습니다. 경과 구간별 우선순위는 현장 경험
        기반 가설이며, 업종별 존속 수치는 이 지역 인허가 데이터의 실측값입니다.
      </p>
    </div>
  );
}
