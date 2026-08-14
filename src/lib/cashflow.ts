import { CASHFLOW_DEFAULTS } from '@/config/cashflow-defaults';
import { LAPSE_GIVEN_CLOSURE } from '@/config/risk-weights';
import { assessBusinessRisk, isBusinessRiskHigh } from '@/lib/risk';
import type { AgentProfile, CashflowResult, ClawbackBracket, Contract, RiskAssessment } from '@/types';

/** 계약 체결 연월('YYYY-MM')로부터 현재까지 유지 개월수 */
export function monthsHeld(contractMonth: string, now: Date = new Date()): number {
  const [y, m] = contractMonth.split('-').map(Number);
  if (!y || !m) return 0;
  return Math.max(0, (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m));
}

/** 유지 개월수에 해당하는 환수율. 마지막 구간 초과 시 0 */
export function clawbackRateFor(held: number, schedule: ClawbackBracket[]): number {
  const sorted = [...schedule].sort((a, b) => a.maxMonth - b.maxMonth);
  for (const bracket of sorted) {
    if (held <= bracket.maxMonth) return bracket.clawbackRate;
  }
  return 0;
}

/**
 * 선지급 수수료 추정 = 월납보험료 × 12(1200% 상한) × 선지급률.
 * 상한 기준이므로 실제보다 클 수 있음 — 노출을 크게 잡는 보수적 추정 (PRD §0).
 */
export function estimateAdvance(monthlyPremium: number, advanceRate: number): number {
  return Math.round(monthlyPremium * 12 * advanceRate);
}

/**
 * 3분할 + 런웨이 계산 (계산식은 PRD §8.3 확정 + 2026-08-13 B 지시로 사업장 존속 위험 결합).
 *
 * 실효 위험계수 = 1 − (1 − 품질계수) × (1 − 업종 24개월 폐업률 × 폐업시 실효율)
 * 환수 노출     = Σ 선지급액 × 환수율(유지월령) × 실효 위험계수
 *
 * 두 위험은 실패 경로가 독립적이라 합집합으로 결합한다 — 결합계수는 어느 단독 위험보다
 * 항상 크거나 같다 (보수성 원칙). 폐업시 실효율(LAPSE_GIVEN_CLOSURE)은 [미검증 가설].
 */
export function calcCashflow(
  profile: AgentProfile,
  contracts: Contract[],
  assessments: RiskAssessment[],
  monthReceivedOverride?: number,
  now: Date = new Date(),
): CashflowResult {
  const byId = new Map(assessments.map((a) => [a.contractId, a]));
  const sumAdvance = contracts.reduce((s, c) => s + (c.advancePaid || 0), 0);
  const monthReceived = monthReceivedOverride ?? sumAdvance;

  let clawbackExposed = 0;
  let highRiskCount = 0;
  let businessHighCount = 0;
  let estimatedBusinessCount = 0;
  for (const contract of contracts) {
    const assessment = byId.get(contract.id);
    if (!assessment) continue;
    const rate = clawbackRateFor(monthsHeld(contract.contractMonth, now), profile.clawbackSchedule);
    const quality = CASHFLOW_DEFAULTS.riskCoefficient[assessment.level];
    const business = assessBusinessRisk(contract);
    const lapseFromClosure = business.closureProb24 * LAPSE_GIVEN_CLOSURE;
    const combined = 1 - (1 - quality) * (1 - lapseFromClosure);
    clawbackExposed += (contract.advancePaid || 0) * rate * combined;
    if (assessment.level === 'high') highRiskCount += 1;
    if (isBusinessRiskHigh(business)) businessHighCount += 1;
    if (business.estimated) estimatedBusinessCount += 1;
  }
  clawbackExposed = Math.round(clawbackExposed);

  const taxReserve = Math.round(monthReceived * CASHFLOW_DEFAULTS.taxReserveRate);
  const recommendedReserve = clawbackExposed + taxReserve;
  // 노출이 수령액을 넘으면 확정 몫이 음수가 될 수 있다 — 클램프하지 않는다.
  // "이번 달 수령액보다 노출이 크다"는 정보 자체가 경고이며, 줄여서 보여주면 과소추정 (PRD §0).
  const securedPortion = monthReceived - clawbackExposed - taxReserve;
  const disposable = monthReceived - recommendedReserve;
  const runwayMonths =
    profile.monthlyFixedExpense > 0 ? (profile.cashOnHand + recommendedReserve) / profile.monthlyFixedExpense : 0;

  return {
    monthReceived,
    securedPortion,
    clawbackExposed,
    highRiskCount,
    businessHighCount,
    estimatedBusinessCount,
    taxReserve,
    recommendedReserve,
    disposable,
    runwayMonths: Math.round(runwayMonths * 10) / 10,
    companyMinimumConflict: profile.companyMinimum > 0 && monthReceived < profile.companyMinimum,
    calculatedAt: now.toISOString(),
  };
}
