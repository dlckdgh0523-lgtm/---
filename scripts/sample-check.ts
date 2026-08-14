/**
 * 계산식 샘플 검증 (빌드 검증용, 앱 번들에 포함되지 않음).
 * 실행: npx tsx scripts/sample-check.ts
 * 계약 3건(고/중/저위험)을 넣고 3분할 + 런웨이가 상식적인지 확인한다.
 */
import { assessRisk } from '../src/lib/risk';
import { calcCashflow, estimateAdvance } from '../src/lib/cashflow';
import { CASHFLOW_DEFAULTS } from '../src/config/cashflow-defaults';
import type { AgentProfile, Contract } from '../src/types';

const NOW = new Date('2026-08-13');

const profile: AgentProfile = {
  avgCommission3m: 350,
  cashOnHand: 500,
  monthlyFixedExpense: 245, // 350 × 70% 기본 제안값
  region: 'yongsan',
  affiliation: 'ga',
  companyTier: 'large-ga',
  advanceRate: CASHFLOW_DEFAULTS.advanceRate,
  mainProductLine: 'third',
  monthlyGoal: 500,
  companyMinimum: 400,
  clawbackSchedule: [...CASHFLOW_DEFAULTS.clawbackSchedule],
  structureSource: { advanceRate: 'default', clawbackSchedule: 'default' },
  optInAnonymousStats: false,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
};

function makeContract(
  id: string,
  label: string,
  premium: number,
  factors: Contract['factors'],
): Contract {
  return {
    id,
    label,
    monthlyPremium: premium,
    advancePaid: estimateAdvance(premium, profile.advanceRate),
    productLine: 'third',
    contractMonth: '2026-08',
    factors,
    createdAt: NOW.toISOString(),
  };
}

const contracts: Contract[] = [
  // 최고 위험 조합: 지인 × 내 부탁 + 빠듯 + 자동이체 미등록
  makeContract('c1', '고위험(지인·부탁·빠듯·미등록)', 20, {
    relationship: 'acquaintance',
    premiumBurden: 'tight',
    motivation: 'my-request',
    autoTransfer: false,
  }),
  // 중위험: 소개, 적정, 필요, 자동이체 미등록
  makeContract('c2', '중위험(소개·적정·필요·미등록)', 15, {
    relationship: 'referral',
    premiumBurden: 'adequate',
    motivation: 'customer-need',
    autoTransfer: false,
  }),
  // 저위험: 개척, 여유, 필요, 자동이체 등록
  makeContract('c3', '저위험(개척·여유·필요·등록)', 10, {
    relationship: 'cold',
    premiumBurden: 'comfortable',
    motivation: 'customer-need',
    autoTransfer: true,
  }),
];

const assessments = contracts.map(assessRisk);
for (const [i, a] of assessments.entries()) {
  console.log(`${contracts[i].label}: score=${a.score} level=${a.level} advance=${contracts[i].advancePaid}만`);
}

const result = calcCashflow(profile, contracts, assessments, undefined, NOW);
console.log('\n--- 3분할 + 런웨이 ---');
console.log(JSON.stringify(result, null, 2));
