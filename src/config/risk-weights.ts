/**
 * 위험 판정 가중치 — ⚠️ 전 계수 [미검증 가설, 조정 가능] (PRD §8.1).
 *
 * 구조 원칙 (2026-08-13 사용자 확정):
 * - 관계 '단독'에는 가중치를 주지 않는다. 지인이라도 본인이 필요를 느껴 든 계약은 잘 유지된다.
 * - 위험한 것은 "내 부탁으로 든 지인 계약" — 조합에 가중한다.
 * - 보수성 원칙: 애매하면 위험을 높게 잡는다. 과소추정("생각보다 여유 있네")이 과대추정보다 해롭다.
 *
 * 검증 계획: 설계사 인터뷰 — "환수 맞은 계약들의 공통점이 뭐였나".
 */

export const RISK_WEIGHTS = {
  base: {
    /** 가입 계기 — 단독 요인 중 최대 가중 */
    motivation: { 'customer-need': 0, 'my-request': 30 } as const,
    /** 보험료 부담 */
    premiumBurden: { comfortable: 0, adequate: 5, tight: 25 } as const,
    /** 자동이체 미등록 */
    autoTransferNotRegistered: 25,
    /** 관계 — 지인·소개 단독 무가중. 개척만 소폭(접점 자체가 약함) */
    relationship: { acquaintance: 0, referral: 0, cold: 10 } as const,
  },
  combo: {
    /** 지인 × 내 부탁 — 핵심 위험 조합 */
    acquaintanceMyRequest: 20,
    /** 빠듯 × 내 부탁 */
    tightMyRequest: 10,
  },
  /** score ≥ high → 상, ≥ medium → 중, 미만 → 하 (0~100 클램프) */
  thresholds: { high: 60, medium: 30 },
} as const;

/**
 * 사업장 폐업이 계약 실효로 이어질 확률 — ⚠️ [미검증 가설, 조정 가능].
 * 폐업해도 개인 보장은 유지될 수 있으므로 1.0이 아니지만, 보수성 원칙(과소추정이 더 해롭다)에
 * 따라 높게 잡는다. 결합식: 실효계수 = 1 − (1−품질계수) × (1−폐업률 × 이 값).
 */
export const LAPSE_GIVEN_CLOSURE = 0.7;

/** 사업장 존속 '고위험' 표시 문턱 (24개월 폐업률) — 전체 평균(~20%) 이상이면 고위험 */
export const BUSINESS_RISK_HIGH_THRESHOLD = 0.2;
