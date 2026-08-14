/**
 * 자금 구조 계산기 기본값.
 *
 * ⚠️ 이 파일의 모든 값은 '제안 기본값'이다 (PRD §0: 입력을 요구하지 말고 제안하라).
 * 화면에는 항상 "예시값이며 실제 조건은 소속사·상품별로 다름"을 명시한다.
 * 보수성 원칙: 애매하면 노출을 크게, 가처분을 작게 (과소추정이 과대추정보다 해롭다).
 */
import type { ClawbackBracket } from '@/types';

export const CASHFLOW_DEFAULTS = {
  /** 선지급률 — 60~70% 관행(업계 보도, 분포 [미확인])의 중앙값 */
  advanceRate: 0.65,
  /**
   * 세금·사업소득 유보율 (2026-08-13 사용자 확정: 기본 10%).
   * 3.3% 원천징수와 별개인 종합소득세 정산 대비분.
   * ⚠️ 화면 문구 필수: "예시값이며 세무 상담을 권장합니다."
   */
  taxReserveRate: 0.1,
  /** 월 고정지출 기본 제안 = 지난 3개월 수수료 평균 × 이 비율 (2026-08-13 확정) */
  fixedExpenseRatio: 0.7,
  /** 위험계수 (2026-08-13 사용자 확정) — 상 0.6 / 중 0.3 / 하 0.1, 중·하위험 포함 */
  riskCoefficient: { high: 0.6, medium: 0.3, low: 0.1 } as const,
  /**
   * 환수 구간 기본값 — ⚠️ 예시값. 실제 환수 조건은 소속사·상품별 계약 내용에 따름.
   * 보수적으로(높게) 설정. 마지막 구간 초과 유지 시 환수율 0으로 처리.
   */
  clawbackSchedule: [
    { maxMonth: 6, clawbackRate: 1.0 },
    { maxMonth: 12, clawbackRate: 0.7 },
    { maxMonth: 24, clawbackRate: 0.3 },
  ] as ClawbackBracket[],
} as const;
