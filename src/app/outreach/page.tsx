'use client';

/**
 * /outreach — 오늘의 홍보 포인트 (서울시 실시간 도시데이터).
 * 접점 리스트(/places)와 목적이 반대다: 접점은 사업주 대상이라 한산할 때가 좋고,
 * 가두 홍보는 불특정 행인 대상이라 사람이 많을수록 좋다 — 정렬도 정반대(예상 최대 인구 내림차순).
 * 실시간 조회 실패 시에도 화면이 죽지 않는다 (장소별 graceful degradation).
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAccount } from '@/lib/account';
import { regionLabel } from '@/data/regions';
import { OUTREACH_PLACES_BY_REGION } from '@/data/outreach-places';
import { AGE_PITCH } from '@/data/outreach-pitch';
import type { CitySnapshot } from '@/app/api/citydata/route';

const INK = 'text-[#191F28]';
const SUB = 'text-[#4E5968]';

type Row =
  | { area: string; status: 'loading' }
  | { area: string; status: 'disabled' }
  | { area: string; status: 'error'; message: string }
  | { area: string; status: 'ok'; data: CitySnapshot };

const CONGEST_COLOR: Record<string, string> = {
  여유: 'bg-emerald-100 text-emerald-700',
  보통: 'bg-sky-100 text-sky-700',
  '약간 붐빔': 'bg-amber-100 text-amber-700',
  붐빔: 'bg-red-100 text-red-700',
};

function todayPeak(d: CitySnapshot): { time: string; max: number } | null {
  const today = new Date().getDate();
  const candidates = d.forecast.filter((f) => new Date(f.time.replace(' ', 'T')).getDate() === today);
  const pool = candidates.length > 0 ? candidates : d.forecast;
  if (pool.length === 0) return null;
  const best = pool.reduce((a, b) => (b.max > a.max ? b : a));
  return { time: best.time.slice(11, 16), max: best.max };
}

function expectedMax(row: Row): number {
  if (row.status !== 'ok') return -1;
  const peak = todayPeak(row.data);
  return peak ? peak.max : row.data.ppltnMax;
}

function dominantAge(ageRates: Record<string, number>): string {
  const [band] = Object.entries(ageRates).reduce((a, b) => (b[1] > a[1] ? b : a));
  return band;
}

export default function OutreachPage() {
  const { status: authStatus, profile } = useAccount();
  const [rows, setRows] = useState<Row[]>([]);
  const region = profile?.region ?? '';
  const places = OUTREACH_PLACES_BY_REGION[region];

  useEffect(() => {
    if (authStatus !== 'ready' || !places) return;
    setRows(places.map((area) => ({ area, status: 'loading' })));
    places.forEach((area) => {
      fetch(`/api/citydata?area=${encodeURIComponent(area)}`)
        .then((r) => r.json())
        .then((lookup) => {
          setRows((prev) =>
            prev.map((row) =>
              row.area === area
                ? lookup.status === 'ok'
                  ? { area, status: 'ok', data: lookup.data }
                  : lookup.status === 'disabled'
                    ? { area, status: 'disabled' }
                    : { area, status: 'error', message: lookup.message ?? '' }
                : row,
            ),
          );
        })
        .catch(() =>
          setRows((prev) => prev.map((row) => (row.area === area ? { area, status: 'error', message: 'network' } : row))),
        );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus, region]);

  const sorted = useMemo(() => [...rows].sort((a, b) => expectedMax(b) - expectedMax(a)), [rows]);
  const allDisabled = rows.length > 0 && rows.every((r) => r.status === 'disabled');

  if (authStatus !== 'ready') return null;

  // 지역별 매핑이 없으면 다른 지역 데이터를 대신 보여주지 않는다 (중복 금지)
  if (!places) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="font-semibold">{region ? regionLabel(region) : ''}의 홍보 포인트 매핑이 없습니다</p>
        <p className="mt-2 text-sm text-slate-500">
          서울시 실시간 도시데이터는 서울 관할 121곳만 제공합니다. 서울 내 다른 구는 장소 조사 후 매핑을 추가하면
          활성화됩니다 — 다른 지역의 수치를 대신 보여주지 않습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className={`text-lg font-bold ${INK}`}>오늘의 홍보 포인트 — {regionLabel(region)} {places.length}곳</h1>
        <p className={`mt-1 text-sm ${SUB}`}>
          가두 홍보는 불특정 행인이 대상이라 <b>사람이 많을수록 좋습니다</b> — 사업주를 만나는{' '}
          <Link href="/places" className="text-[#3182F6] underline">접점 리스트</Link>와 정렬 기준이 정반대(예상 최대
          인구 내림차순)입니다.
        </p>
      </div>

      {allDisabled && (
        <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-8 text-center text-sm text-amber-800">
          서울시 실시간 도시데이터 키(SEOUL_DATA_API_KEY) 대기 중 — 키가 들어오면 실시간 혼잡도·예측·행사가
          표시됩니다. 장소 목록과 화면 구조는 준비돼 있습니다.
        </div>
      )}

      <ul className="space-y-3">
        {sorted.map((row) => (
          <li key={row.area} className="rounded-2xl border border-[#F2F4F6] bg-white p-5 shadow-[0_8px_24px_rgba(25,31,40,0.05)]">
            <div className="flex items-center justify-between gap-2">
              <h2 className={`font-bold ${INK}`}>{row.area}</h2>
              {row.status === 'ok' && (
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${CONGEST_COLOR[row.data.congestLvl] ?? 'bg-slate-100 text-slate-600'}`}>
                  현재 {row.data.congestLvl}
                </span>
              )}
              {row.status === 'loading' && <span className="text-xs text-slate-400">조회 중…</span>}
              {row.status === 'error' && <span className="text-xs text-slate-400">조회 실패 — 잠시 후 갱신</span>}
              {row.status === 'disabled' && <span className="text-xs text-slate-400">키 대기</span>}
            </div>

            {row.status === 'ok' && (
              <div className="mt-3 space-y-2 text-sm">
                {(() => {
                  const peak = todayPeak(row.data);
                  return (
                    <p className={SUB}>
                      {peak ? (
                        <>오늘 최대 혼잡 예상 <b className="text-[#3182F6]">{peak.time}</b> (약 {peak.max.toLocaleString()}명)</>
                      ) : (
                        '예측 데이터 없음'
                      )}
                      {' · '}현재 {row.data.ppltnMin.toLocaleString()}~{row.data.ppltnMax.toLocaleString()}명 ({row.data.observedAt.slice(11, 16)} 기준)
                    </p>
                  );
                })()}

                {/* 연령 구성 */}
                <div className="flex items-end gap-0.5" style={{ height: 44 }}>
                  {Object.entries(row.data.ageRates).map(([band, rate]) => {
                    const max = Math.max(...Object.values(row.data.ageRates), 1);
                    return (
                      <div key={band} className="flex flex-1 flex-col items-center gap-0.5">
                        <div className="w-full rounded-t bg-[#3182F6]/70" style={{ height: `${(rate / max) * 32}px` }} />
                        <span className="text-[9px] text-slate-400">{band === '0' ? '~9' : band}</span>
                      </div>
                    );
                  })}
                  <span className="ml-2 shrink-0 text-xs text-slate-500">
                    주류 {dominantAge(row.data.ageRates)}대 · 남 {row.data.maleRate}% / 여 {row.data.femaleRate}%
                  </span>
                </div>

                {/* 소구점 — 구조만, 값은 TODO */}
                {(AGE_PITCH[dominantAge(row.data.ageRates)]?.pitches.length ?? 0) > 0 ? (
                  <p className={SUB}>소구점: {AGE_PITCH[dominantAge(row.data.ageRates)].pitches.join(' · ')}</p>
                ) : (
                  <p className="text-xs text-slate-400">연령대별 소구점 준비 중 (실무 검토 후 채워짐)</p>
                )}

                {/* 상주/비상주 해석 */}
                <p className="rounded-lg bg-[#F9FAFB] p-2.5 text-xs leading-relaxed text-slate-500">
                  상주 {row.data.resntRate}% / 비상주 {row.data.nonResntRate}% —{' '}
                  {row.data.nonResntRate >= 60
                    ? '비상주(관광·유동) 중심이라 재접촉이 어려운 곳'
                    : '상주(지역 주민) 비중이 있어 재방문 가능성이 있는 곳'}
                  으로 해석됩니다 <b>[미검증 가설]</b>.
                </p>

                {/* 행사 — 응답 확인 결과 카테고리 필드는 없음(행사명·기간·장소·유료여부만 제공) */}
                {row.data.events.length > 0 && (
                  <div className="text-xs text-slate-500">
                    <p className="font-semibold text-slate-600">진행·예정 행사</p>
                    <ul className="mt-0.5 list-disc pl-4">
                      {row.data.events.slice(0, 4).map((ev) => (
                        <li key={ev.name}>
                          {ev.url ? (
                            <a href={ev.url} target="_blank" rel="noreferrer" className="underline">{ev.name}</a>
                          ) : (
                            ev.name
                          )}{' '}
                          ({ev.period}{ev.payYn ? ` · ${ev.payYn === 'Y' ? '유료' : '무료'}` : ''})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <p className="text-xs text-slate-400">
        출처: 서울시 실시간 도시데이터 (5분 캐시). 장소 목록은 121개 전수 조사로 확정한 용산구 관할 10곳입니다.
        연령·상주 비율 해석과 소구점 매핑은 검증되지 않은 가설·준비 중 항목으로 표기합니다.
      </p>
    </div>
  );
}
