'use client';

/**
 * /insights — 생존 분석 시각화. 제출물의 검증 근거 화면.
 * 데이터: public/data/regions/{code}/survival.json (scripts/build-survival.ts 산출)
 * 여기 결론은 "가설 방어"가 아니라 데이터 판정이다 — 반증됐다면 그대로 표시한다.
 */
import { useEffect, useState } from 'react';
import { useAccount } from '@/lib/account';
import { regionLabel } from '@/data/regions';

interface CondStat {
  survival: number;
  ciLow: number;
  ciHigh: number;
  atRisk: number;
  reliable: boolean;
}

interface SurvivalData {
  sigunguCode: string;
  generatedAt: string;
  sample: { total: number; closed: number; open: number };
  caveats: string[];
  survival: { overall: number[]; recentCohort2015: number[] };
  byCategory: Record<string, { n: number; closed: number; surv: number[] }>;
  closureHist: { label: string; count: number }[];
  hazardTable: { label: string; start: number; end: number; overall: number }[];
  cond24: { ageMonths: number; survivePlus24: number; recentCohort: number; byCategory: Record<string, number> }[];
  cond24at6: { overall: CondStat; recentCohort2015: CondStat; byCategory: Record<string, CondStat> };
  seasonality: number[];
}

const INK = 'text-[#191F28]';
const SUB = 'text-[#4E5968]';
const pctf = (v: number) => `${(v * 100).toFixed(1)}%`;

/** 0~maxM 개월 생존곡선 SVG */
function SurvCurve({ series, maxM = 60 }: { series: { data: number[]; color: string; label: string }[]; maxM?: number }) {
  const W = 560;
  const H = 220;
  const PAD = 36;
  const x = (m: number) => PAD + (m / maxM) * (W - PAD - 10);
  const y = (s: number) => 10 + (1 - s) * (H - PAD - 10);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[1, 0.75, 0.5, 0.25].map((g) => (
          <g key={g}>
            <line x1={PAD} x2={W - 10} y1={y(g)} y2={y(g)} stroke="#E5E8EB" strokeWidth={1} />
            <text x={4} y={y(g) + 4} fontSize={10} fill="#8B95A1">{Math.round(g * 100)}%</text>
          </g>
        ))}
        {[0, 12, 24, 36, 48, 60].map((m) => (
          <text key={m} x={x(m)} y={H - 14} fontSize={10} fill="#8B95A1" textAnchor="middle">{m}개월</text>
        ))}
        {series.map((s) => (
          <polyline
            key={s.label}
            fill="none"
            stroke={s.color}
            strokeWidth={2.5}
            points={s.data.slice(0, maxM + 1).map((v, m) => `${x(m)},${y(v)}`).join(' ')}
          />
        ))}
      </svg>
      {/* 범례는 SVG 밖 HTML로 — 곡선과 겹치지 않게 (2026-08-14 피드백) */}
      <div className="mt-2 flex flex-wrap gap-4">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs text-[#4E5968]">
            <span className="inline-block h-1 w-4 rounded" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Bars({ rows, color = '#3182F6', format = pctf }: { rows: { label: string; value: number; sub?: string }[]; color?: string; format?: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 0.0001);
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3 text-sm">
          <span className={`w-40 shrink-0 ${SUB}`}>{r.label}{r.sub && <span className="text-xs text-[#8B95A1]"> {r.sub}</span>}</span>
          <div className="h-5 flex-1 rounded bg-[#F2F4F6]">
            <div className="h-5 rounded" style={{ width: `${(r.value / max) * 100}%`, backgroundColor: color }} />
          </div>
          <b className={`w-16 text-right ${INK}`}>{format(r.value)}</b>
        </div>
      ))}
    </div>
  );
}

export default function InsightsPage() {
  const { status, profile } = useAccount();
  const [data, setData] = useState<SurvivalData | null>(null);
  const [regionCode, setRegionCode] = useState('');
  const [failed, setFailed] = useState(false);

  // 지역별로 그 지역의 분석만 보여준다 — 다른 지역 데이터로 폴백(중복 표시)하지 않는다 (2026-08-13)
  useEffect(() => {
    if (status !== 'ready' || !profile) return;
    setRegionCode(profile.region);
    fetch(`/data/regions/${profile.region}/survival.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, [status, profile]);

  if (status !== 'ready') return null;
  if (failed) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="font-semibold">{regionCode ? regionLabel(regionCode) : ''}의 존속 분석이 아직 없습니다</p>
        <p className="mt-2 text-sm text-slate-500">
          이 지역의 데이터 팩과 생존 분석이 준비되면 표시됩니다. 다른 지역의 수치를 대신 보여주지 않습니다 — 지역이
          다르면 폐업 패턴도 다르기 때문입니다.
        </p>
      </div>
    );
  }
  if (!data) {
    return <p className={`py-20 text-center ${SUB}`}>불러오는 중…</p>;
  }

  const at6 = data.cond24.find((c) => c.ageMonths === 6)!;
  // 표본 검증 규칙: 위험집합(atRisk) 30 미만 업종은 점추정을 노출하지 않는다
  const catStats = Object.entries(data.cond24at6.byCategory);
  const reliableRows = catStats
    .filter(([, v]) => v.reliable)
    .map(([c, v]) => ({
      label: c,
      value: v.survival,
      sub: `n=${v.atRisk.toLocaleString()} · CI ${(v.ciLow * 100).toFixed(1)}~${(v.ciHigh * 100).toFixed(1)}%`,
    }))
    .sort((a, b) => a.value - b.value);
  const maskedRows = catStats.filter(([, v]) => !v.reliable);
  const seasonMax = Math.max(...data.seasonality);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className={`text-2xl font-bold ${INK}`}>존속 분석 — {regionLabel(data.sigunguCode)}</h1>
        <p className={`mt-1 text-sm ${SUB}`}>
          인허가 레코드 {data.sample.total.toLocaleString()}건(폐업 {data.sample.closed.toLocaleString()} · 영업{' '}
          {data.sample.open.toLocaleString()}) · 우측 중도절단 반영 Kaplan-Meier(월 단위)
        </p>
      </div>

      {/* 판정 */}
      <section className="rounded-3xl bg-[#191F28] p-7 text-white">
        <p className="text-sm font-bold text-[#4E9EFF]">판정 — "개업 3~6개월 = 우선 접촉" 가설</p>
        <h2 className="mt-2 text-xl font-bold leading-snug">반증되지 않았다. 나이는 위험을 거의 가르지 않고, 업종이 가른다.</h2>
        <ul className="mt-4 space-y-2 text-sm leading-relaxed text-slate-300">
          <li>
            · 사업장 나이 6개월에서 <b className="text-white">이후 24개월을 더 생존할 확률은 {pctf(at6.survivePlus24)}</b>
            (2015년 이후 코호트 {pctf(at6.recentCohort)}) — 나이 3·12·24·36개월과의 차이가 ±1%p 이내라, "폐업 집중
            구간이 접촉 직후에 온다"는 우려는 데이터로 기각된다.
          </li>
          <li>
            · 오히려 3~6개월은 구간 조건부 폐업률이 가장 낮고(2.4%), 개업 직후 0~2개월(4.8%)이 더 위험하다 — '관망'
            라벨과 정합.
          </li>
          <li>
            · 단서 ①: 어느 나이든 <b className="text-white">약 5건 중 1건은 24개월 안에 폐업</b>한다. 접점 리스트에서
            딴 계약은 사업장 폐업만으로도 이 확률만큼 환수 위험을 갖는다 — 계산기와 접점 리스트가 같은 앱에 있는 이유.
          </li>
          <li>
            · 단서 ②: 업종 격차가 크다 — 휴게음식점 {pctf(at6.byCategory['휴게음식점'] ?? 0)} vs 숙박업{' '}
            {pctf(at6.byCategory['숙박업'] ?? 0)}. <b className="text-white">업종 필터는 편의기능이 아니라 위험 관리
            장치다.</b>
          </li>
        </ul>
      </section>

      {/* 핵심 지표 표 */}
      <section className="rounded-3xl border border-[#F2F4F6] bg-white p-6 shadow-[0_8px_24px_rgba(25,31,40,0.05)]">
        <h3 className={`font-bold ${INK}`}>나이별 +24개월 추가 생존 확률 (판정 지표)</h3>
        <p className={`mt-1 text-xs ${SUB}`}>24개월 = 예시 환수 구간의 최장 구간. 이 값이 나이에 따라 급락하면 가설이 반증된다.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#F2F4F6] text-left text-xs text-[#8B95A1]">
                <th className="py-2">사업장 나이</th>
                <th>+24개월 생존 (전체)</th>
                <th>+24개월 생존 (2015+ 코호트)</th>
              </tr>
            </thead>
            <tbody>
              {data.cond24.map((c) => (
                <tr key={c.ageMonths} className={`border-b border-[#F9FAFB] ${c.ageMonths === 6 ? 'bg-[#E8F3FF] font-bold' : ''}`}>
                  <td className="py-2">{c.ageMonths}개월{c.ageMonths === 6 && ' ← 우선 접촉'}</td>
                  <td>{pctf(c.survivePlus24)}</td>
                  <td>{pctf(c.recentCohort)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 생존 곡선 */}
      <section className="rounded-3xl border border-[#F2F4F6] bg-white p-6 shadow-[0_8px_24px_rgba(25,31,40,0.05)]">
        <h3 className={`font-bold ${INK}`}>존속 곡선 (0~60개월)</h3>
        <SurvCurve
          series={[
            { data: data.survival.overall, color: '#3182F6', label: '전체 코호트' },
            { data: data.survival.recentCohort2015, color: '#F04452', label: '2015년 이후 인허가' },
          ]}
        />
      </section>

      {/* 구간 조건부 폐업률 */}
      <section className="rounded-3xl border border-[#F2F4F6] bg-white p-6 shadow-[0_8px_24px_rgba(25,31,40,0.05)]">
        <h3 className={`font-bold ${INK}`}>존속 구간별 조건부 폐업률</h3>
        <p className={`mb-3 mt-1 text-xs ${SUB}`}>해당 구간 시작 시점 생존 사업장 중 구간 내 폐업 비율</p>
        <Bars rows={data.hazardTable.map((h) => ({ label: h.label, value: h.overall }))} color="#F04452" />
      </section>

      {/* 업종별 */}
      <section className="rounded-3xl border border-[#F2F4F6] bg-white p-6 shadow-[0_8px_24px_rgba(25,31,40,0.05)]">
        <h3 className={`font-bold ${INK}`}>업종별 +24개월 생존 (나이 6개월 기준, 위험 오름차순)</h3>
        <p className={`mb-3 mt-1 text-xs ${SUB}`}>
          격차가 크므로 업종 필터가 위험 관리 장치가 된다. n = 나이 6개월 시점 위험집합 크기, CI = Greenwood 95%
          신뢰구간. <b>표본 30건 미만 업종은 점추정을 표시하지 않는다.</b>
        </p>
        <Bars rows={reliableRows} />
        {maskedRows.length > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            표본 부족으로 수치 미표시: {maskedRows.map(([c, v]) => `${c}(n=${v.atRisk})`).join(', ')} — 이 업종을
            근거로 접촉을 권장하지 않습니다.
          </p>
        )}
      </section>

      {/* 개인 보장 연결 — 존속 곡선의 함의 */}
      <section className="rounded-3xl border border-[#F2F4F6] bg-white p-6 shadow-[0_8px_24px_rgba(25,31,40,0.05)]">
        <h3 className={`font-bold ${INK}`}>이 곡선은 화재보험만의 이야기가 아니다</h3>
        <p className={`mt-2 text-sm leading-relaxed ${SUB}`}>
          접점의 대상은 사업장이 아니라 <b>사업주(사람)</b>다. 사업장이 폐업하면 사업주의 소득이 끊기고, 사업 보장뿐
          아니라 그 사람 앞으로 든 <b>건강·종신·연금 같은 개인 보장까지 실효될 수 있다.</b> 위 존속 곡선은 사업
          보장의 유지 위험인 동시에 개인 보장의 유지 위험이며, 그래서 자금 계산기의 위험 모델은 계약 품질(4문항)과
          별도로 사업장 존속 위험(업종 24개월 폐업률)을 반영한다.
        </p>
      </section>

      {/* 계절성 */}
      <section className="rounded-3xl border border-[#F2F4F6] bg-white p-6 shadow-[0_8px_24px_rgba(25,31,40,0.05)]">
        <h3 className={`font-bold ${INK}`}>개업 월 분포 (2016년 이후 인허가)</h3>
        {/* px 높이 사용 — %높이는 auto 높이 부모에서 0으로 붕괴해 아무것도 안 보였음 (2026-08-14 버그 수정) */}
        <div className="mt-3 flex items-end gap-1">
          {data.seasonality.map((v, i) => (
            <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[10px] text-[#8B95A1]">{v.toLocaleString()}</span>
              <div className="w-full rounded-t bg-[#3182F6]/70" style={{ height: `${Math.max(4, (v / seasonMax) * 90)}px` }} />
              <span className="text-[10px] text-[#8B95A1]">{i + 1}월</span>
            </div>
          ))}
        </div>
        <p className={`mt-2 text-xs ${SUB}`}>봄(3~7월) 개업이 가을 대비 약 30% 많음 — 완만한 계절성</p>
      </section>

      {/* 한계 */}
      <section className="rounded-2xl bg-[#F9FAFB] p-5 text-xs leading-relaxed text-[#8B95A1]">
        <p className="font-semibold text-[#4E5968]">방법의 한계 (정직 고지)</p>
        <ul className="mt-1 list-disc pl-4">
          {data.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
