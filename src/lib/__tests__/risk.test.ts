/**
 * 위험 판정 검증 — 4문항 조합 가중(핵심: "내 부탁으로 든 지인 계약") + 업종 존속 위험.
 * 기대 점수는 config/risk-weights.ts 계수로 손계산.
 */
import { assessBusinessRisk, assessRisk, BUSINESS_CATEGORY_OPTIONS, isBusinessRiskHigh } from '@/lib/risk';
import { BUSINESS_RISK_HIGH_THRESHOLD } from '@/config/risk-weights';
import industryRisk from '@/data/industry-risk.generated.json';
import type { Contract, ContractFactors } from '@/types';

function contractWith(factors: ContractFactors, businessCategory?: Contract['businessCategory']): Contract {
  return {
    id: 'c-t',
    label: 't',
    monthlyPremium: 10,
    advancePaid: 100,
    productLine: 'third',
    contractMonth: '2026-08',
    factors,
    businessCategory,
    createdAt: new Date('2026-08-14').toISOString(),
  };
}

describe('assessRisk — 품질 4문항', () => {
  it('전부 안전: 0점 하위험, 요인 없음', () => {
    const r = assessRisk(
      contractWith({ relationship: 'referral', premiumBurden: 'comfortable', motivation: 'customer-need', autoTransfer: true }),
    );
    expect(r.score).toBe(0);
    expect(r.level).toBe('low');
    expect(r.drivers).toHaveLength(0);
  });

  it('지인 단독은 무가중 — 본인 필요로 든 지인 계약은 안전', () => {
    const r = assessRisk(
      contractWith({ relationship: 'acquaintance', premiumBurden: 'comfortable', motivation: 'customer-need', autoTransfer: true }),
    );
    expect(r.score).toBe(0);
    expect(r.level).toBe('low');
  });

  it('핵심 조합 — 내 부탁 × 지인: 30 + 콤보 20 = 50점 중위험', () => {
    const r = assessRisk(
      contractWith({ relationship: 'acquaintance', premiumBurden: 'comfortable', motivation: 'my-request', autoTransfer: true }),
    );
    expect(r.score).toBe(50);
    expect(r.level).toBe('medium');
    expect(r.drivers).toContain('relationship');
  });

  it('최악 조합: 내부탁30 + 빠듯25 + 자동이체25 + 지인콤보20 + 빠듯콤보10 = 100+ → 100 클램프, 상위험', () => {
    const r = assessRisk(
      contractWith({ relationship: 'acquaintance', premiumBurden: 'tight', motivation: 'my-request', autoTransfer: false }),
    );
    expect(r.score).toBe(100);
    expect(r.level).toBe('high');
  });

  it('경계값: 개척10 + 적정5 = 15점 하위험 / 개척10 + 빠듯25 = 35점 중위험', () => {
    expect(
      assessRisk(contractWith({ relationship: 'cold', premiumBurden: 'adequate', motivation: 'customer-need', autoTransfer: true }))
        .level,
    ).toBe('low');
    expect(
      assessRisk(contractWith({ relationship: 'cold', premiumBurden: 'tight', motivation: 'customer-need', autoTransfer: true }))
        .level,
    ).toBe('medium');
  });
});

describe('assessBusinessRisk — 업종 존속 위험', () => {
  const safeFactors: ContractFactors = {
    relationship: 'referral',
    premiumBurden: 'comfortable',
    motivation: 'customer-need',
    autoTransfer: true,
  };

  it("'사업장 아님': 폐업 확률 0, 추정 아님", () => {
    const b = assessBusinessRisk(contractWith(safeFactors, 'none'));
    expect(b.closureProb24).toBe(0);
    expect(b.source).toBe('none');
    expect(isBusinessRiskHigh(b)).toBe(false);
  });

  it('미입력: 전체 평균으로 추정 (estimated=true) — 지어내지 않고 평균 사용', () => {
    const b = assessBusinessRisk(contractWith(safeFactors, undefined));
    expect(b.source).toBe('average');
    expect(b.estimated).toBe(true);
    expect(b.closureProb24).toBe(industryRisk.avgClosure24);
  });

  it('실측 업종: 생존 분석 json의 값을 그대로 사용 (단일 출처)', () => {
    const reliable = BUSINESS_CATEGORY_OPTIONS.find(
      (c) => (industryRisk.industries as Record<string, { reliable: boolean }>)[c].reliable,
    );
    expect(reliable).toBeDefined();
    const b = assessBusinessRisk(contractWith(safeFactors, reliable));
    const entry = (industryRisk.industries as Record<string, { closure24: number }>)[reliable!];
    expect(b.closureProb24).toBe(entry.closure24);
    expect(b.estimated).toBe(false);
  });

  it('고위험 문턱 경계 (평균 이상 = 고위험)', () => {
    expect(isBusinessRiskHigh({ contractId: 'x', closureProb24: BUSINESS_RISK_HIGH_THRESHOLD, source: 'industry', estimated: false })).toBe(true);
    expect(isBusinessRiskHigh({ contractId: 'x', closureProb24: BUSINESS_RISK_HIGH_THRESHOLD - 0.001, source: 'industry', estimated: false })).toBe(false);
  });
});
