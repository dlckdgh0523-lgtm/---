/**
 * 자금 구조 계산기(3분할 + 런웨이) 결과.
 * 문구 원칙: 금액을 권고하지 않는다 — 구조를 드러낸다.
 * ("250만원을 저축하세요" ✕ / "250만원은 아직 확정된 돈이 아닙니다" ○)
 * 금액 단위: 만원. 전 필드 로컬 전용 — 서버·LLM에는 비율/구간 변환값만 (llm.ts 참조).
 */

export interface CashflowResult {
  /** 이번 달 수령액 */
  monthReceived: number;
  /** 확정 몫 = 수령액 − 환수 노출 몫 − 세금·사업소득 유보 */
  securedPortion: number;
  /**
   * 환수 노출 몫.
   * ⚠️ 계산식은 원 기획에 미정의 — 제안식(PRD §8.3, 승인 대기):
   * Σ (위험도 상/중 계약의 이번 달 선지급 수수료 × 해당 유지개월 구간 환수율)
   */
  clawbackExposed: number;
  /** 계약 품질 위험 '상' 건수 (4문항 기반 — 계약자 개인 요인) */
  highRiskCount: number;
  /** 사업장 존속 고위험 건수 (업종 24개월 폐업률 ≥ 문턱 — 구조적 요인). 성격이 달라 분리 표시 */
  businessHighCount: number;
  /** 업종 미입력으로 전체 평균을 추정 적용한 계약 수 — 화면에 추정치임을 표시 */
  estimatedBusinessCount: number;
  /** 세금·사업소득 유보 — 유보율 기본값 미확정 (PRD §9-6), 임시 3.3% */
  taxReserve: number;
  /** 권장 유보액 = 환수 노출 몫 + 세금 유보 */
  recommendedReserve: number;
  /** 이번 달 실제 가처분 = 수령액 − 권장 유보액 */
  disposable: number;
  /**
   * 런웨이 (버틸 개월수) — 화면에서 가장 크게 표시.
   * = (보유 현금 + 권장 유보액) ÷ 월 고정지출
   * 월 고정지출은 원 기획에 없어 AgentProfile에 추가한 필드 (승인 대기).
   */
  runwayMonths: number;
  /** 회사 권장 최소치와 개인 재무 안전의 충돌 여부 — 결과 화면 경고 문구 트리거 */
  companyMinimumConflict: boolean;
  calculatedAt: string;
}
