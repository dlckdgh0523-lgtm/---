/**
 * 3분할(확정/환수 노출/세금 유보)·런웨이 계산 검증 — "숫자는 코드가 만든다" 원칙의 실검증.
 * 기대값은 전부 손계산으로 도출 (계수: 상0.6/중0.3/하0.1, 세금 10%, LAPSE_GIVEN_CLOSURE 0.7).
 */
import { calcCashflow, clawbackRateFor, estimateAdvance, monthsHeld } from '@/lib/cashflow';
import { assessRisk } from '@/lib/risk';
import { CASHFLOW_DEFAULTS } from '@/config/cashflow-defaults';
import type { AgentProfile, Contract, ContractFactors } from '@/types';

const NOW = new Date('2026-08-14');

const SAFE_FACTORS: ContractFactors = {
  relationship: 'referral',
  premiumBurden: 'comfortable',
  motivation: 'customer-need',
  autoTransfer: true,
};

function makeProfile(over: Partial<AgentProfile> = {}): AgentProfile {
  return {
    avgCommission3m: 300,
    cashOnHand: 500,
    monthlyFixedExpense: 100,
    region: '11170',
    affiliation: 'ga',
    companyTier: 'large-ga',
    advanceRate: 0.65,
    mainProductLine: 'third',
    monthlyGoal: 0,
    companyMinimum: 0,
    clawbackSchedule: CASHFLOW_DEFAULTS.clawbackSchedule.map((b) => ({ ...b })),
    structureSource: { advanceRate: 'default', clawbackSchedule: 'default' },
    optInAnonymousStats: false,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  };
}

function makeContract(over: Partial<Contract> = {}): Contract {
  return {
    id: over.id ?? 'c-1',
    label: '테스트',
    monthlyPremium: 10,
    advancePaid: 1000,
    productLine: 'third',
    contractMonth: '2026-06', // 2개월 유지 → 환수율 1.0 구간
    factors: { ...SAFE_FACTORS },
    businessCategory: 'none', // 사업장 아님 → 존속 위험 0 (결합계수 = 품질계수)
    createdAt: NOW.toISOString(),
    ...over,
  };
}

describe('monthsHeld', () => {
  it('체결 연월부터 현재까지의 개월수', () => {
    expect(monthsHeld('2026-06', NOW)).toBe(2);
    expect(monthsHeld('2025-08', NOW)).toBe(12);
  });
  it('미래 연월·손상 입력은 0', () => {
    expect(monthsHeld('2027-01', NOW)).toBe(0);
    expect(monthsHeld('garbage', NOW)).toBe(0);
  });
});

describe('clawbackRateFor', () => {
  const schedule = CASHFLOW_DEFAULTS.clawbackSchedule;
  it('구간 경계: 6개월 이하 100%, 7~12개월 70%, 13~24개월 30%, 초과 0%', () => {
    expect(clawbackRateFor(0, schedule)).toBe(1.0);
    expect(clawbackRateFor(6, schedule)).toBe(1.0);
    expect(clawbackRateFor(7, schedule)).toBe(0.7);
    expect(clawbackRateFor(12, schedule)).toBe(0.7);
    expect(clawbackRateFor(13, schedule)).toBe(0.3);
    expect(clawbackRateFor(24, schedule)).toBe(0.3);
    expect(clawbackRateFor(25, schedule)).toBe(0);
  });
  it('정렬 안 된 스케줄도 동일 결과', () => {
    const shuffled = [schedule[2], schedule[0], schedule[1]];
    expect(clawbackRateFor(7, shuffled)).toBe(0.7);
  });
});

describe('estimateAdvance', () => {
  it('월납 × 12 × 선지급률 (1200% 상한 기준 보수적 추정)', () => {
    expect(estimateAdvance(30, 0.65)).toBe(234);
    expect(estimateAdvance(0, 0.65)).toBe(0);
  });
});

describe('calcCashflow — 3분할', () => {
  it('하위험 1건: 노출 = 선지급 × 환수율 × 0.1, 세금 = 수령액 × 10%, 확정 = 나머지', () => {
    const profile = makeProfile();
    const contracts = [makeContract()];
    const r = calcCashflow(profile, contracts, contracts.map(assessRisk), undefined, NOW);
    // 손계산: 1000 × 1.0(2개월) × 0.1(하위험, 사업장 아님) = 100
    expect(r.clawbackExposed).toBe(100);
    expect(r.taxReserve).toBe(100); // 1000 × 0.1
    expect(r.securedPortion).toBe(800); // 1000 − 100 − 100
    expect(r.recommendedReserve).toBe(200);
    expect(r.highRiskCount).toBe(0);
  });

  it('상위험(내 부탁 지인 + 빠듯 + 자동이체 미등록): 위험계수 0.6 적용', () => {
    const profile = makeProfile();
    const contracts = [
      makeContract({
        factors: { relationship: 'acquaintance', premiumBurden: 'tight', motivation: 'my-request', autoTransfer: false },
      }),
    ];
    const r = calcCashflow(profile, contracts, contracts.map(assessRisk), undefined, NOW);
    expect(r.highRiskCount).toBe(1);
    expect(r.clawbackExposed).toBe(600); // 1000 × 1.0 × 0.6
  });

  it('계약 0건: 노출 0, 세금 0, 런웨이 = 보유현금/고정지출', () => {
    const r = calcCashflow(makeProfile(), [], [], undefined, NOW);
    expect(r.clawbackExposed).toBe(0);
    expect(r.taxReserve).toBe(0);
    expect(r.securedPortion).toBe(0);
    expect(r.runwayMonths).toBe(5.0); // (500 + 0) / 100
  });

  it('노출이 수령액을 넘으면 확정 몫이 음수 — 클램프하지 않는다 (과소추정 금지)', () => {
    const profile = makeProfile();
    const contracts = [
      makeContract({
        factors: { relationship: 'acquaintance', premiumBurden: 'tight', motivation: 'my-request', autoTransfer: false },
      }),
    ];
    // 수령액을 노출(600)+세금보다 작게 오버라이드
    const r = calcCashflow(profile, contracts, contracts.map(assessRisk), 500, NOW);
    expect(r.securedPortion).toBeLessThan(0);
  });

  it('고정지출 0이면 런웨이 0 (0 나눗셈 방어)', () => {
    const r = calcCashflow(makeProfile({ monthlyFixedExpense: 0 }), [], [], undefined, NOW);
    expect(r.runwayMonths).toBe(0);
  });

  it('업종 미입력: 평균 폐업률로 추정 + estimated 카운트, 결합계수는 품질 단독보다 크다', () => {
    const profile = makeProfile();
    const withBiz = [makeContract({ businessCategory: undefined })];
    const noBiz = [makeContract()]; // 'none'
    const rWith = calcCashflow(profile, withBiz, withBiz.map(assessRisk), undefined, NOW);
    const rNone = calcCashflow(profile, noBiz, noBiz.map(assessRisk), undefined, NOW);
    expect(rWith.estimatedBusinessCount).toBe(1);
    expect(rNone.estimatedBusinessCount).toBe(0);
    // 보수성: 존속 위험이 결합되면 노출은 항상 크거나 같다
    expect(rWith.clawbackExposed).toBeGreaterThan(rNone.clawbackExposed);
  });

  it('회사 최소치 충돌 플래그', () => {
    const r = calcCashflow(makeProfile({ companyMinimum: 2000 }), [makeContract()], [assessRisk(makeContract())], undefined, NOW);
    expect(r.companyMinimumConflict).toBe(true);
  });
});
