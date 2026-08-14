'use client';

/**
 * /admin — 관리자 대시보드 (익명 집계 · LLM 운영(MLOps) · 서비스 현황).
 * 접근: ADMIN_EMAILS 화이트리스트 (기존 JWT 세션 재사용). 비관리자는 404 — 경로 자체를 숨긴다.
 * 개인 식별값(이메일 주소·금액 원본·계약 상세)은 이 화면 어디에도 없다 — 서버 API가 반환하지 않는다.
 */
import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';

interface TierAgg {
  n: number;
  advanceRates: number[];
  userStructureCount: number;
}

interface LevelCount {
  high: number;
  medium: number;
  low: number;
}

interface Overview {
  ok: boolean;
  minSample: number;
  aggregates: {
    optInCount: number;
    byTier: Record<string, TierAgg>;
    byProduct: Record<string, number>;
    riskDistribution: { total: number; byProduct: Record<string, LevelCount>; byIndustry: Record<string, LevelCount> };
    structure: Record<string, { n: number; reliable: boolean; advanceRateMedian: number | null; advanceRates: number[] }>;
  };
  llm: {
    today: Record<string, { ok: number; fail: number; retries: number; avgLatencyMs: number | null; guardBlocks: Record<string, number> }>;
    limits: Record<string, number>;
  };
  service: {
    subscriberCount: number;
    regions: { code: string; name: string; recordCount: number; builtAt: string }[];
    lastNotifyRun: { at: string; total: number; okCount: number; dry: boolean } | null;
  };
  facts: AdminFacts;
  cross: Cross;
  latestEval: EvalSummary | null;
}

interface EvalSummary {
  ts: string;
  total: number;
  stableCount: number;
  unstableCount: number;
  passRate: number;
  baseline: number;
  byFeature: Record<string, { stable: number; total: number }>;
  regressions: string[];
}

interface AdminFacts {
  pipeline: {
    regions: { code: string; name: string; recordCount: number; builtAt: string; distribution: Record<string, number> }[];
    baseScan: { scanned: number; inRegion: number; open: number; noCoord: number } | null;
    datasets: { file: string; encoding: string; crs: string }[];
  };
  dataQuality: {
    coordCrs: string;
    crsHitRate: Record<string, string>;
    coordMissing: number;
    joinMatchRate: number;
    joinNote: string;
    crsMedianError: string;
    relicenseSuspectPct: number;
    relicenseNote: string;
  };
  analysis: {
    survivalSample: { total: number; closed: number; open: number } | null;
    industryGapPct: number | null;
    industryRange: { low: string; lowSurv: number; high: string; highSurv: number } | null;
    maskedBelowSample: number;
    minSample: number;
  };
  quality: { jestSuites: number; jestCases: number; jestPassing: boolean; ci: string; dockerVerified: boolean; note: string };
}

interface Dist {
  n: number;
  blocked: boolean;
  masked: boolean;
  median: number | null;
  q1: number | null;
  q3: number | null;
  min: number | null;
  max: number | null;
}
interface ClawCP {
  n: number;
  blocked: boolean;
  masked: boolean;
  checkpoints: Record<string, number | null>;
}
interface Cross {
  kAnonMin: number;
  minSample: number;
  advanceByTier: Record<string, Dist>;
  clawbackByTier: Record<string, ClawCP>;
  productByTier: Record<string, Record<string, number | null>>;
  clawbackByProduct: Record<string, ClawCP>;
  minimumByTier: Record<string, { n: number; blocked: boolean; withMinimum: number | null }>;
  totalStructure: number;
  totalContract: number;
}

const TIER_LABEL: Record<string, string> = {
  'captive-life': '전속(생보)',
  'captive-nonlife': '전속(손보)',
  'large-ga': 'GA(대형)',
  'small-ga': 'GA(중소)',
};
const PRODUCT_LABEL: Record<string, string> = { life: '생명', third: '제3보험', general: '손해(일반)', auto: '자동차', savings: '저축성' };
const FEATURE_LABEL: Record<string, string> = {
  scenario: '접근 시나리오',
  'roleplay-turn': '롤플레잉 대화',
  'roleplay-score': '롤플레잉 채점',
  hint: '힌트',
};
const LIMIT_BY_FEATURE: Record<string, string> = {
  scenario: 'scenarios',
  'roleplay-turn': 'roleplayTurns',
  'roleplay-score': 'scores',
  hint: 'hints',
};

/** 샘플 분포 — 실데이터가 30건을 넘기 전까지 UI 형태를 보여주기 위한 가짜 값. 반드시 '샘플' 라벨과 함께만 렌더 */
const SAMPLE_ADVANCE_DIST = [
  { range: '50~60%', count: 9 },
  { range: '60~70%', count: 21 },
  { range: '70~80%', count: 14 },
  { range: '80~90%', count: 4 },
];

/** 비율(0~1)을 % 문자열로. null은 '—'. 환수율은 1.0=100% */
function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 font-bold text-[#191F28]">{title}</h2>
      {children}
    </section>
  );
}

export default function AdminPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    fetch('/api/admin/overview', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) {
          setDenied(true);
          return null;
        }
        return r.json();
      })
      .then((j) => j && setData(j as Overview))
      .catch(() => setDenied(true));
  }, []);

  if (denied) notFound(); // 비관리자에게는 이 경로가 존재하지 않는 것처럼
  if (!data) return null;

  const { aggregates, llm, service, minSample } = data;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* 정직 고지 — 상단 고정 */}
      <div className="sticky top-14 z-30 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
        <p className="font-bold">⚠️ 정직 고지</p>
        <p>
          현재 실사용자가 사실상 개발자 1인이므로 <b>아래 모든 집계는 통계적 의미가 없습니다.</b> 관리자와
          사용자가 동일인이라는 구조적 한계가 있으며, "샘플" 표기가 붙은 항목은 UI 형태를 보여주기 위한 가짜
          데이터입니다. 이 화면은 수집·표시 구조가 동작함을 보이는 것이 목적입니다.
        </p>
      </div>

      <h1 className="text-xl font-extrabold text-[#191F28]">관리자</h1>

      {/* 1) 익명 집계 */}
      <Section title={`익명 집계 — 옵트인 ${aggregates.optInCount}명`}>
        <div className="space-y-4 text-sm">
          <div>
            <p className="mb-1 font-semibold text-slate-700">
              소속 형태별 선지급률 (익명 구조 레코드 — 직접 입력값만, 계정 조인 불가)
            </p>
            {/* 실데이터가 1건이라도 있으면 실측값을 보인다. 샘플 막대는 0건일 때만.
                이유: 실측값 1건이 라벨링된 가짜 분포보다 정보량이 크다 (2026-08-14 지시). */}
            {Object.entries(aggregates.structure).length > 0 ? (
              Object.entries(aggregates.structure).map(([tier, s]) => (
                <p key={tier} className="text-slate-600">
                  {TIER_LABEL[tier] ?? tier}: 표본 {s.n}건 —{' '}
                  {s.reliable && s.advanceRateMedian != null ? (
                    <>중앙값 {Math.round(s.advanceRateMedian * 100)}% <span className="text-emerald-600">(신규 사용자 프리셋에 반영 중)</span></>
                  ) : (
                    <span className="text-amber-600">
                      {Math.round((s.advanceRates.reduce((a, b) => a + b, 0) / (s.advanceRates.length || 1)) * 100)}% (표본 {s.n}건, {minSample}건 미만이라 프리셋 미적용)
                    </span>
                  )}
                </p>
              ))
            ) : (
              <>
                <p className="text-slate-400">아직 수집된 실데이터 없음 — 아래는 UI 형태 예시입니다.</p>
                <div className="mt-2 rounded-lg bg-[#F9FAFB] p-3">
                  <p className="mb-1 text-xs font-bold text-red-500">샘플 — 실데이터 아님 (실데이터가 1건이라도 들어오면 이 막대는 사라지고 실측값이 표시됩니다)</p>
                  <div className="flex items-end gap-2">
                    {SAMPLE_ADVANCE_DIST.map((b) => (
                      <div key={b.range} className="flex flex-col items-center gap-1">
                        <div className="w-10 rounded-t bg-slate-300" style={{ height: `${b.count * 3}px` }} />
                        <span className="text-[10px] text-slate-400">{b.range}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <div>
            <p className="mb-1 font-semibold text-slate-700">환수 구간 직접 설정 사용자</p>
            {Object.entries(aggregates.byTier).map(([tier, agg]) => (
              <p key={tier} className="text-slate-600">
                {TIER_LABEL[tier] ?? tier}: {agg.userStructureCount}명 / {agg.n}명
              </p>
            ))}
          </div>
          <div>
            <p className="mb-1 font-semibold text-slate-700">주력 상품 분포</p>
            <p className="text-slate-600">
              {Object.entries(aggregates.byProduct)
                .map(([k, v]) => `${PRODUCT_LABEL[k] ?? k} ${v}명`)
                .join(' · ') || '데이터 없음'}
            </p>
          </div>
          <div>
            <p className="mb-1 font-semibold text-slate-700">
              상품·업종별 위험도 분포 (익명 계약 구조 레코드 {aggregates.riskDistribution.total}건 — 금액·계정 없음)
            </p>
            {aggregates.riskDistribution.total === 0 && (
              <p className="text-slate-400">수집된 레코드 없음 — 옵트인 사용자가 계약을 등록하면 채워집니다</p>
            )}
            {Object.entries(aggregates.riskDistribution.byProduct).map(([prod, d]) => (
              <p key={prod} className="text-slate-600">
                {PRODUCT_LABEL[prod] ?? prod}: 상 {d.high} · 중 {d.medium} · 하 {d.low}
              </p>
            ))}
            {Object.entries(aggregates.riskDistribution.byIndustry).length > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                업종별:{' '}
                {Object.entries(aggregates.riskDistribution.byIndustry)
                  .map(([ind, d]) => `${ind}(상${d.high}/중${d.medium}/하${d.low})`)
                  .join(' · ')}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-400">
              계약 원본(금액·별칭)은 여전히 서버에 없다 — 클라이언트 암호화 유지. 이 분포는 옵트인 사용자의
              비식별 구조값(구간·문항·등급)만으로 집계된다.
            </p>
          </div>
        </div>
      </Section>

      {/* 2) LLM 운영 모니터링 */}
      <Section title="LLM 운영 (오늘 기준)">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
                <th className="py-1.5">기능</th>
                <th>성공</th>
                <th>실패</th>
                <th>재시도</th>
                <th>평균 지연</th>
                <th>가드 차단</th>
                <th>한도 대비</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(llm.today).map(([feature, m]) => {
                const total = m.ok + m.fail;
                const limit = llm.limits[LIMIT_BY_FEATURE[feature]];
                const guardTotal = Object.values(m.guardBlocks).reduce((s, v) => s + v, 0);
                return (
                  <tr key={feature} className="border-b border-slate-100 text-slate-600">
                    <td className="py-1.5 font-medium">{FEATURE_LABEL[feature] ?? feature}</td>
                    <td>{m.ok}</td>
                    <td className={m.fail > 0 ? 'text-red-600' : ''}>{m.fail}</td>
                    <td>{m.retries}</td>
                    <td>{m.avgLatencyMs != null ? `${(m.avgLatencyMs / 1000).toFixed(1)}s` : '—'}</td>
                    <td>
                      {guardTotal}
                      {guardTotal > 0 && (
                        <span className="ml-1 text-xs text-slate-400">
                          ({Object.entries(m.guardBlocks).map(([k, v]) => `${k}:${v}`).join(', ')})
                        </span>
                      )}
                    </td>
                    <td className="text-xs">{total} / {limit ?? '—'} <span className="text-slate-400">(계정별 한도)</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          가드 차단 사유: hard:* = 출력 전체 폐기(키·경로 형태), sentence:* = 문장 제거(재무 권고·가입 단정·법령).
          지연은 라우트 처리 전체 기준. 한도는 계정별이라 "호출 합계 / 한도"는 참고용.
        </p>
      </Section>

      {/* LLM 회귀 평가 (골든셋) — 품질 회귀 감지 */}
      <Section title="LLM 회귀 평가 (골든셋)">
        {data.latestEval ? (
          <div className="space-y-2 text-sm text-slate-600">
            <p>
              최근 실행: <b>{data.latestEval.ts.slice(0, 16).replace('T', ' ')}</b> · 안정{' '}
              <b>{data.latestEval.stableCount}/{data.latestEval.total}</b> (통과율 {Math.round(data.latestEval.passRate * 100)}%,
              기준선 {Math.round(data.latestEval.baseline * 100)}%)
            </p>
            <p>
              기능별 안정 케이스:{' '}
              {Object.entries(data.latestEval.byFeature).map(([f, v]) => `${f} ${v.stable}/${v.total}`).join(' · ')}
            </p>
            <p>
              불안정 케이스(3회 중 일부만 통과 — 결함): <b className={data.latestEval.unstableCount > 0 ? 'text-amber-600' : ''}>{data.latestEval.unstableCount}건</b>
            </p>
            {data.latestEval.regressions.length > 0 && (
              <p className="text-red-600">⚠️ 직전 대비 회귀(안정→불안정): {data.latestEval.regressions.join(', ')}</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-400">
            아직 실행 이력 없음 — <code>npm run eval</code>로 골든셋 24케이스를 3회씩 실행하면 결과가 여기 표시됩니다.
          </p>
        )}
        <p className="mt-2 text-xs text-slate-400">
          ⚠️ 골든셋은 개발자 1인이 작성했고 현업 검증을 받지 않았습니다. 케이스 24건은 통계적 신뢰도가 낮아 회귀의
          '방향'을 보는 용도입니다. LLM은 비결정적이라 각 케이스를 3회 실행해 "1회 통과"를 통과로 치지 않습니다.
        </p>
      </Section>

      {/* 3) 서비스 현황 */}
      <Section title="서비스 현황">
        <div className="space-y-2 text-sm text-slate-600">
          <p>이메일 구독자: <b>{service.subscriberCount}명</b> <span className="text-xs text-slate-400">(주소 목록은 관리자에게도 미노출)</span></p>
          <div>
            <p className="font-semibold text-slate-700">지역 데이터 팩</p>
            {service.regions.map((r) => (
              <p key={r.code}>
                {r.name} ({r.code}) — {r.recordCount.toLocaleString()}건 · 빌드 {r.builtAt.slice(0, 10)}
              </p>
            ))}
            {service.regions.length === 0 && <p className="text-slate-400">팩 없음</p>}
          </div>
          <p>
            최근 발송:{' '}
            {service.lastNotifyRun
              ? `${service.lastNotifyRun.at.slice(0, 16).replace('T', ' ')} · 대상 ${service.lastNotifyRun.total}명 중 ${service.lastNotifyRun.okCount}건 성공${service.lastNotifyRun.dry ? ' (dry-run)' : ''}`
              : '기록 없음'}
          </p>
        </div>
      </Section>

      {/* 4) 데이터 파이프라인 현황 — 실측 (실사용자 0명이어도 0이 아님) */}
      <Section title="데이터 파이프라인 현황 (실측)">
        <div className="space-y-3 text-sm text-slate-600">
          {data.facts.pipeline.baseScan && (
            <p>
              기준 지역(용산) 원본 스캔: <b>{data.facts.pipeline.baseScan.scanned.toLocaleString()}행</b> 스캔 →
              지역 내 {data.facts.pipeline.baseScan.inRegion.toLocaleString()} → 영업중 {data.facts.pipeline.baseScan.open.toLocaleString()} →
              좌표 결측 {data.facts.pipeline.baseScan.noCoord}건 제외
            </p>
          )}
          <div>
            <p className="mb-1 font-semibold text-slate-700">지역별 레코드 · 빌드 시각 · 경과 구간 분포</p>
            {data.facts.pipeline.regions.map((r) => (
              <div key={r.code} className="mb-1.5">
                <p>
                  <b>{r.name}</b> — {r.recordCount.toLocaleString()}건 · 빌드 {r.builtAt.slice(0, 16).replace('T', ' ')}
                </p>
                <p className="text-xs text-slate-400">
                  {Object.entries(r.distribution).map(([k, v]) => `${k.split('(')[0]} ${v.toLocaleString()}`).join(' · ')}
                </p>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-1 font-semibold text-slate-700">원본 데이터셋 ({data.facts.pipeline.datasets.length}종)</p>
            <p className="text-xs text-slate-400">
              {data.facts.pipeline.datasets.map((d) => d.file.replace('_서울특별시.csv', '')).join(', ')} · 인코딩 CP949 · 좌표계 {data.facts.pipeline.datasets[0]?.crs}
            </p>
          </div>
        </div>
      </Section>

      {/* 5) 데이터 품질 지표 — 실측 */}
      <Section title="데이터 품질 지표 (실측)">
        <div className="space-y-1.5 text-sm text-slate-600">
          <p>조인 매칭률: <b>{Math.round(data.facts.dataQuality.joinMatchRate * 1000) / 10}%</b> <span className="text-xs text-slate-400">— {data.facts.dataQuality.joinNote}</span></p>
          <p>재인허가 의심: <b>{Math.round(data.facts.dataQuality.relicenseSuspectPct * 1000) / 10}%</b> <span className="text-xs text-slate-400">— {data.facts.dataQuality.relicenseNote}</span></p>
          <p>좌표 결측 제외: <b>{data.facts.dataQuality.coordMissing}건</b></p>
          <p>
            좌표계 판별: <b>{data.facts.dataQuality.coordCrs}</b> 확정
            <span className="text-xs text-slate-400"> — bbox로는 {Object.entries(data.facts.dataQuality.crsHitRate).map(([k, v]) => `${k} ${v}`).join(', ')}로 구분 불가 → {data.facts.dataQuality.crsMedianError}</span>
          </p>
        </div>
      </Section>

      {/* 6) 분석 결과 요약 — 실측 */}
      <Section title="분석 결과 요약 (실측)">
        <div className="space-y-1.5 text-sm text-slate-600">
          {data.facts.analysis.survivalSample && (
            <p>
              생존 분석 표본: <b>{data.facts.analysis.survivalSample.total.toLocaleString()}건</b>
              <span className="text-xs text-slate-400"> (폐업 {data.facts.analysis.survivalSample.closed.toLocaleString()} 사건 / 영업 {data.facts.analysis.survivalSample.open.toLocaleString()} 중도절단)</span>
            </p>
          )}
          {data.facts.analysis.industryGapPct != null && data.facts.analysis.industryRange && (
            <p>
              업종별 24개월 생존율 격차: <b>{data.facts.analysis.industryGapPct}%p</b>
              <span className="text-xs text-slate-400"> ({data.facts.analysis.industryRange.low} {data.facts.analysis.industryRange.lowSurv}% ~ {data.facts.analysis.industryRange.high} {data.facts.analysis.industryRange.highSurv}%)</span>
            </p>
          )}
          <p>
            표본 {data.facts.analysis.minSample}건 미만 마스킹 업종:{' '}
            <b>{data.facts.analysis.maskedBelowSample}개</b>
            <span className="text-xs text-slate-400"> (전부 30건 이상이라 마스킹 없음)</span>
          </p>
        </div>
      </Section>

      {/* 8) 구조 데이터 교차 분석 — 제품이 축적하려는 핵심 데이터 */}
      <Section title="구조 데이터 교차 분석 (제품 축적 데이터)">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            소속 구조 레코드 {data.cross.totalStructure}건 · 계약 {data.cross.totalContract}건 ·{' '}
            k-익명성 {data.cross.kAnonMin}건 미만 셀 차단 · {data.cross.minSample}건 미만 표본 부족
          </p>
          <div className="flex gap-2">
            <a href="/api/admin/export?format=csv" className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">CSV 내보내기</a>
            <a href="/api/admin/export?format=json" className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">JSON 내보내기</a>
          </div>
        </div>

        <div className="space-y-4 text-sm">
          {/* 1) 소속 × 선지급률 */}
          <div>
            <p className="mb-1 font-semibold text-slate-700">① 소속 구분 × 선지급률 분포</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-xs">
                <thead><tr className="border-b border-slate-200 text-left text-slate-400"><th className="py-1">소속</th><th>표본</th><th>중앙값</th><th>Q1~Q3</th><th>최소~최대</th></tr></thead>
                <tbody>
                  {Object.entries(data.cross.advanceByTier).map(([tier, d]) => (
                    <tr key={tier} className="border-b border-slate-100 text-slate-600">
                      <td className="py-1 font-medium">{TIER_LABEL[tier] ?? tier}</td>
                      <td>{d.n}</td>
                      {d.blocked ? (
                        <td colSpan={3} className="text-amber-600">표본 부족(k-익명성 차단, {d.n}/{data.cross.kAnonMin})</td>
                      ) : d.masked ? (
                        <td colSpan={3} className="text-amber-600">표본 부족({d.n}/{data.cross.minSample}) — 참고: 중앙값 {pct(d.median)}</td>
                      ) : (
                        <>
                          <td className="font-semibold">{pct(d.median)}</td>
                          <td>{pct(d.q1)}~{pct(d.q3)}</td>
                          <td>{pct(d.min)}~{pct(d.max)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 2) 소속 × 환수 구간 — 핵심 */}
          <div>
            <p className="mb-1 font-semibold text-slate-700">② 소속 구분 × 환수 구간 <span className="rounded bg-[#E8F3FF] px-1.5 py-0.5 text-[10px] text-[#3182F6]">이 제품이 축적하려는 핵심 데이터 — 공개되지 않은 회사별 환수 조건</span></p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[380px] text-xs">
                <thead><tr className="border-b border-slate-200 text-left text-slate-400"><th className="py-1">소속</th><th>표본</th><th>6개월</th><th>12개월</th><th>24개월</th></tr></thead>
                <tbody>
                  {Object.entries(data.cross.clawbackByTier).map(([tier, c]) => (
                    <tr key={tier} className="border-b border-slate-100 text-slate-600">
                      <td className="py-1 font-medium">{TIER_LABEL[tier] ?? tier}</td>
                      <td>{c.n}</td>
                      {c.blocked ? (
                        <td colSpan={3} className="text-amber-600">표본 부족({c.n}/{data.cross.kAnonMin})</td>
                      ) : (
                        <>
                          <td>{pct(c.checkpoints['6'])}</td>
                          <td>{pct(c.checkpoints['12'])}</td>
                          <td>{pct(c.checkpoints['24'])}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 3) 소속 × 상품 */}
          <div>
            <p className="mb-1 font-semibold text-slate-700">③ 소속 구분 × 주력 상품</p>
            {Object.entries(data.cross.productByTier).map(([tier, prods]) => {
              const cells = Object.entries(prods).filter(([, v]) => v !== null);
              return (
                <p key={tier} className="text-xs text-slate-600">
                  {TIER_LABEL[tier] ?? tier}: {cells.length ? cells.map(([p, v]) => `${PRODUCT_LABEL[p] ?? p} ${v}건`).join(' · ') : <span className="text-slate-400">표본 부족 또는 없음</span>}
                </p>
              );
            })}
          </div>

          {/* 4) 상품 × 환수 */}
          <div>
            <p className="mb-1 font-semibold text-slate-700">④ 상품 구분 × 환수 조건</p>
            {Object.keys(data.cross.clawbackByProduct).length === 0 && <p className="text-xs text-slate-400">수집된 레코드 없음</p>}
            {Object.entries(data.cross.clawbackByProduct).map(([prod, c]) => (
              <p key={prod} className="text-xs text-slate-600">
                {PRODUCT_LABEL[prod] ?? prod}: 표본 {c.n}건 — {c.blocked ? <span className="text-amber-600">표본 부족({c.n}/{data.cross.kAnonMin})</span> : `6개월 ${pct(c.checkpoints['6'])} · 12개월 ${pct(c.checkpoints['12'])} · 24개월 ${pct(c.checkpoints['24'])}`}
              </p>
            ))}
          </div>

          {/* 5) 최소치 유무 × 소속 */}
          <div>
            <p className="mb-1 font-semibold text-slate-700">⑤ 회사 권장 최소치 존재 여부 × 소속 <span className="text-[10px] text-slate-400">(목표 압박이 어느 구분에 집중되는지)</span></p>
            {Object.entries(data.cross.minimumByTier).map(([tier, m]) => (
              <p key={tier} className="text-xs text-slate-600">
                {TIER_LABEL[tier] ?? tier}: {m.blocked ? <span className="text-amber-600">표본 부족({m.n}/{data.cross.kAnonMin})</span> : `${m.withMinimum}/${m.n}명이 최소치 있음`}
              </p>
            ))}
          </div>

          <p className="border-t border-slate-200 pt-2 text-[10px] leading-relaxed text-slate-400">
            ⚠️ 골든셋은 개발자 1인이 작성했고 현업 검증을 받지 않았습니다. 케이스 수가 적어 통계적 신뢰도가 낮습니다.
            교차 필터를 좁히면 개인이 특정될 수 있어, 셀 표본이 {data.cross.kAnonMin}건 미만이면 수치를 차단합니다(k-익명성).
            내보내기는 집계값만 포함하며 개별 레코드·이메일은 나가지 않습니다.
          </p>
        </div>
      </Section>

      {/* 7) 품질 보증 — 실측 */}
      <Section title="품질 보증 (실측)">
        <div className="space-y-1.5 text-sm text-slate-600">
          <p>Jest: <b>{data.facts.quality.jestSuites}스위트 {data.facts.quality.jestCases}케이스</b> {data.facts.quality.jestPassing ? <span className="text-emerald-600">전원 통과</span> : <span className="text-red-600">실패</span>}</p>
          <p>CI: <span className="text-xs">{data.facts.quality.ci}</span></p>
          <p>Docker 이미지 빌드·산출물 대조: {data.facts.quality.dockerVerified ? <span className="text-emerald-600">검증됨</span> : <span className="text-slate-400">미검증</span>}</p>
          <p className="text-xs text-slate-400">{data.facts.quality.note}</p>
        </div>
      </Section>

      <p className="text-xs text-slate-400">
        이 화면은 개인 식별값을 표시하지 않습니다 — 이메일·금액 원본·계약 상세는 서버 API가 반환하지 않으며, 프로필
        금액은 클라이언트 암호화라 서버(관리자 포함)가 열 수 없습니다. 상단 익명 집계·LLM 운영은 실사용에 따라
        채워지고, 아래 파이프라인·품질·분석·QA는 실사용자 0명이어도 시스템이 실제로 처리한 실측값입니다.
      </p>
    </div>
  );
}
