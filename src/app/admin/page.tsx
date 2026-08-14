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
            {Object.entries(aggregates.structure).length === 0 && <p className="text-slate-400">수집된 레코드 없음</p>}
            {Object.entries(aggregates.structure).map(([tier, s]) => (
              <p key={tier} className="text-slate-600">
                {TIER_LABEL[tier] ?? tier}: 표본 {s.n}건 —{' '}
                {s.reliable && s.advanceRateMedian != null ? (
                  <>중앙값 {Math.round(s.advanceRateMedian * 100)}% <span className="text-emerald-600">(신규 사용자 프리셋에 반영 중)</span></>
                ) : (
                  <span className="text-amber-600">표본 부족 (&lt;{minSample}건, 수치 미노출 — 공통 예시값 사용 중)</span>
                )}
              </p>
            ))}
            <div className="mt-2 rounded-lg bg-[#F9FAFB] p-3">
              <p className="mb-1 text-xs font-bold text-red-500">샘플 — 실데이터 아님 (표본 {minSample}건 도달 시 실분포로 대체)</p>
              <div className="flex items-end gap-2">
                {SAMPLE_ADVANCE_DIST.map((b) => (
                  <div key={b.range} className="flex flex-col items-center gap-1">
                    <div className="w-10 rounded-t bg-slate-300" style={{ height: `${b.count * 3}px` }} />
                    <span className="text-[10px] text-slate-400">{b.range}</span>
                  </div>
                ))}
              </div>
            </div>
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

      <p className="text-xs text-slate-400">
        이 화면은 개인 식별값을 표시하지 않습니다 — 이메일·금액 원본·계약 상세는 서버 API가 반환하지 않으며, 프로필
        금액은 클라이언트 암호화라 서버(관리자 포함)가 열 수 없습니다.
      </p>
    </div>
  );
}
