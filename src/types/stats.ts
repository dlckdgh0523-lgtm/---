/**
 * 익명 구조값 레코드 — 서버로 나가는 '유일한' 사용자 유래 평문 데이터 (2026-08-14 수집 정책).
 *
 * 분류 기준:
 *   개인의 재산 상태(금액 원본) → 클라이언트 암호화, 서버 수집 금지
 *   회사의 정책·계약의 구조적 속성(비율·구간·구분·문항) → 옵트인 시 익명 수집
 *
 * 조인 불가 원칙: 레코드에 이메일·계정 ID를 저장하지 않는다. id는 서버가 부여하는 랜덤값.
 * GIGO 방지: 사용자가 직접 입력한 값만 저장 (기본값 재집계 순환 금지) — enteredBy: 'user' 고정.
 * 이 타입에 number 필드를 추가할 때는 '비율 또는 구간인지' 반드시 검토할 것. 금액 원본 금지.
 */
import type { AgentProfile, Affiliation, ClawbackBracket, ProductLine } from './agent';
import type { ContractFactors, RiskLevel } from './contract';

/** 프로필 구조값 — 소속사별 수수료 구조 역산용 */
export interface StructureRecord {
  schemaVersion: 2;
  id: string; // 서버 부여 랜덤 — 계정과 조인 불가
  enteredBy: 'user'; // 직접 입력 값만 저장된다는 플래그
  affiliation: Affiliation;
  companyTier: AgentProfile['companyTier'];
  mainProductLine: ProductLine;
  /** structureSource가 'user'인 경우에만 존재 */
  advanceRate?: number;
  clawbackSchedule?: ClawbackBracket[];
  /** 회사 권장 최소치의 '존재 여부'만 — 금액은 저장하지 않는다 */
  hasCompanyMinimum: boolean;
  createdAt: string;
}

/** 월납 보험료 구간 (만원) — 정확한 금액이 아니라 구간만 */
export type PremiumBand = '~5' | '5~10' | '10~20' | '20~30' | '30~50' | '50+';

export function premiumBandOf(monthlyPremium: number): PremiumBand {
  if (monthlyPremium < 5) return '~5';
  if (monthlyPremium < 10) return '5~10';
  if (monthlyPremium < 20) return '10~20';
  if (monthlyPremium < 30) return '20~30';
  if (monthlyPremium < 50) return '30~50';
  return '50+';
}

/** 계약 구조값 — 상품/업종별 위험 분포용. 금액 원본·계약자 정보 없음 */
export interface ContractStructureRecord {
  schemaVersion: 2;
  id: string;
  enteredBy: 'user';
  productLine: ProductLine;
  premiumBand: PremiumBand;
  factors: ContractFactors; // 4문항 응답 — 구조적 속성
  businessCategory: string | null; // 업종 (없으면 null)
  riskLevel: RiskLevel; // 클라이언트 결정론 판정의 등급만 (점수·금액 없음)
  createdAt: string;
}
