/**
 * 이번 달 계약 1건 + 위험 판정.
 * 설계 원칙 (PRD §8.1): 환수 확률을 직접 묻지 않는다 — 낙관 편향으로 오염됨.
 * 대신 예측 요인 4가지를 '사실'로 묻는다.
 * ⚠️ 계약자 실명·연락처 입력 금지 — label은 사용자가 붙이는 별칭이며 UI에서 안내한다.
 */
import type { ProductLine } from './agent';

/** 4문항 응답 — 전부 사실 질문, 확률·의견 질문 없음 */
export interface ContractFactors {
  /** 계약자와의 관계 */
  relationship: 'acquaintance' | 'referral' | 'cold'; // 지인 / 소개 / 개척
  /** 보험료가 계약자 소득 대비 */
  premiumBurden: 'comfortable' | 'adequate' | 'tight'; // 여유 / 적정 / 빠듯
  /** 가입 계기 */
  motivation: 'customer-need' | 'my-request'; // 계약자가 필요를 느껴서 / 내 부탁으로
  /** 자동이체 등록 여부 */
  autoTransfer: boolean;
}

export interface Contract {
  id: string;
  /** 별칭 (예: "카페 사장님") — 실명 금지, 로컬 전용 */
  label: string;
  /** 월납보험료 (만원) — 로컬 전용, LLM에는 구간으로만 전달 */
  monthlyPremium: number;
  /**
   * 이번 달 선지급 수수료 (만원) — 확정 계산식의 입력 (PRD §8.3). 로컬 전용.
   * 명세서 확인값 입력 권장. 모르면 UI가 월납보험료 × 12(1200% 상한) × 선지급률로
   * 추정치를 제안 — 상한 기준이라 노출을 크게 잡는 보수적 추정 (PRD §0 보수성 원칙).
   */
  advancePaid: number;
  productLine: ProductLine;
  /** 계약 체결 연월 'YYYY-MM' — 유지 개월수 및 환수 구간 판정 기준 */
  contractMonth: string;
  factors: ContractFactors;
  /**
   * 계약자 사업장 업종 (선택, 2026-08-13 B 지시) — 사업장 존속 위험의 입력.
   * - 업종명: industry-risk.generated.json 키 ('일반음식점' 등, 생존 분석 실측)
   * - 'none': 사업장 아님(직장인 등) → 존속 위험 0. 지시의 "미입력→평균"을 그대로 쓰면
   *   사업장 없는 계약에 존속 위험을 잘못 씌우므로 명시적 3상태로 세분화 (MEMORY.md)
   * - undefined: 미입력 → 전체 평균 폐업률 적용 + 추정치 표시
   */
  businessCategory?: string | 'none';
  createdAt: string;
}

/**
 * 사업장 존속 위험 — 계약 품질(4문항)과 성격이 다른 구조적 위험.
 * 4문항 = 이 계약이 유지될까(계약자 개인 요인) / 업종 = 사업장이 존속할까(구조적 요인)
 */
export interface BusinessRiskAssessment {
  contractId: string;
  /** 24개월 내 사업장 폐업 확률 (생존 분석 실측) */
  closureProb24: number;
  /** industry=업종 실측 / average=미입력·표본부족으로 전체 평균 / none=사업장 아님 */
  source: 'industry' | 'average' | 'none';
  industryLabel?: string;
  /** 평균 대체 시 true — 화면에 '추정' 표시 */
  estimated: boolean;
}

export type RiskLevel = 'high' | 'medium' | 'low';

/**
 * 위험 판정 결과 — 조합 가중 구조 (2026-08-13 수정, PRD §8.1).
 * 관계 단독에 가중치를 주지 않는다. 위험한 것은 "내 부탁으로 든 지인 계약" 조합.
 * ⚠️ 전 계수 [미검증 가설, 조정 가능] — src/config/risk-weights.ts 상수 분리.
 * 검증 계획: 설계사 인터뷰 "환수 맞은 계약들의 공통점이 뭐였나".
 */
export interface RiskAssessment {
  contractId: string;
  score: number;                 // 가중 합 (정규화 0~100)
  level: RiskLevel;
  /** 판정 근거가 된 요인 키 목록 — 챗봇 결과 해석에 사용 (예: 'no-auto-transfer') */
  drivers: (keyof ContractFactors)[];
}
