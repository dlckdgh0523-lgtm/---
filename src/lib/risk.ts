import { BUSINESS_RISK_HIGH_THRESHOLD, RISK_WEIGHTS } from '@/config/risk-weights';
import industryRisk from '@/data/industry-risk.generated.json';
import type { BusinessRiskAssessment, Contract, ContractFactors, RiskAssessment, RiskLevel } from '@/types';

/** 계약 1건의 위험 판정 — 계수는 전부 config, [미검증 가설] */
export function assessRisk(contract: Contract): RiskAssessment {
  const f = contract.factors;
  const w = RISK_WEIGHTS.base;
  let score = 0;
  const drivers: (keyof ContractFactors)[] = [];

  const motivation = w.motivation[f.motivation];
  if (motivation > 0) {
    score += motivation;
    drivers.push('motivation');
  }

  const burden = w.premiumBurden[f.premiumBurden];
  score += burden;
  if (f.premiumBurden === 'tight') drivers.push('premiumBurden');

  if (!f.autoTransfer) {
    score += w.autoTransferNotRegistered;
    drivers.push('autoTransfer');
  }

  score += w.relationship[f.relationship];
  if (f.relationship === 'cold') drivers.push('relationship');

  // 조합 가중 — 위험한 것은 "내 부탁으로 든 지인 계약" (PRD §8.1)
  if (f.relationship === 'acquaintance' && f.motivation === 'my-request') {
    score += RISK_WEIGHTS.combo.acquaintanceMyRequest;
    if (!drivers.includes('relationship')) drivers.push('relationship');
  }
  if (f.premiumBurden === 'tight' && f.motivation === 'my-request') {
    score += RISK_WEIGHTS.combo.tightMyRequest;
  }

  score = Math.min(100, score);
  const level: RiskLevel =
    score >= RISK_WEIGHTS.thresholds.high ? 'high' : score >= RISK_WEIGHTS.thresholds.medium ? 'medium' : 'low';

  return { contractId: contract.id, score, level, drivers };
}

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = { high: '상', medium: '중', low: '하' };

interface IndustryRiskEntry {
  closure24: number;
  ciLow: number;
  ciHigh: number;
  atRisk: number;
  reliable: boolean;
}
const INDUSTRIES = industryRisk.industries as Record<string, IndustryRiskEntry>;

/** 계산기 업종 선택지 — 생존 분석에 존재하는 업종만 (임의 목록 금지) */
export const BUSINESS_CATEGORY_OPTIONS = Object.keys(INDUSTRIES);

/**
 * 사업장 존속 위험 판정 (2026-08-13 B 지시).
 * - 업종 선택 → 해당 업종의 24개월 폐업률 (생존 분석 실측, 표본<30이면 평균으로 대체)
 * - '사업장 아님' → 0
 * - 미입력 → 전체 평균 + estimated=true (화면에 '추정' 표시)
 */
export function assessBusinessRisk(contract: Contract): BusinessRiskAssessment {
  const base = { contractId: contract.id };
  if (contract.businessCategory === 'none') {
    return { ...base, closureProb24: 0, source: 'none', estimated: false };
  }
  const entry = contract.businessCategory ? INDUSTRIES[contract.businessCategory] : undefined;
  if (entry && entry.reliable) {
    return {
      ...base,
      closureProb24: entry.closure24,
      source: 'industry',
      industryLabel: contract.businessCategory,
      estimated: false,
    };
  }
  // 미입력이거나 표본 부족 업종 — 전체 평균으로 추정 (표본 부족 업종을 근거로 쓰지 않는다)
  return { ...base, closureProb24: industryRisk.avgClosure24, source: 'average', estimated: true };
}

export function isBusinessRiskHigh(assessment: BusinessRiskAssessment): boolean {
  return assessment.source !== 'none' && assessment.closureProb24 >= BUSINESS_RISK_HIGH_THRESHOLD;
}

/** 챗봇 결과 해석·화면 설명에 쓰는 요인 문구 */
export const DRIVER_LABEL: Record<keyof ContractFactors, string> = {
  relationship: '관계 요인 (내 부탁으로 든 지인 계약 또는 개척)',
  premiumBurden: '보험료가 소득 대비 빠듯함',
  motivation: '계약자 필요가 아닌 내 부탁으로 가입',
  autoTransfer: '자동이체 미등록',
};
