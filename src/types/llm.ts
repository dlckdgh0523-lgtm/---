/**
 * LLM(챗봇) 호출 페이로드 — 금액 원본이 프롬프트에 들어가는 것을 타입 수준에서 차단한다.
 * 서버 라우트에서만 Anthropic API 호출 (키는 ANTHROPIC_API_KEY 환경변수).
 * 모델은 실무 수치를 지어내지 않도록 이 페이로드에 있는 숫자만 사용하게 시스템 프롬프트로 제약.
 */
import type { RiskLevel, ContractFactors } from './contract';

/** 금액 → 구간 변환. 원본 금액 필드는 이 파일의 어떤 타입에도 존재하지 않는다. */
export type AmountBracket = 'under-100' | '100-300' | '300-500' | '500-1000' | 'over-1000'; // 만원 구간

/** 계약 1건의 비식별 요약 — label(별칭)도 보내지 않는다. 인덱스로만 지칭. */
export interface ContractSummaryForLLM {
  index: number;                       // "1번 계약" 식으로 지칭
  riskLevel: RiskLevel;
  factors: ContractFactors;            // 사실 응답 4개 — 식별성 없음
  premiumBracket: AmountBracket;
}

/** 챗봇 목적형 3모드 — 자유 대화 없음 */
export type ChatMode =
  | 'diagnose'   // 자가진단 진행: 4문항을 대화로 수집
  | 'interpret'  // 결과 해석: "고위험 3건이 모두 지인+자동이체 미등록" 식 구조 설명
  | 'clarify';   // 불확실 답변 처리: "이번 주에 자동이체 등록 여부부터 확인하세요"

export interface ChatContext {
  mode: ChatMode;
  contracts: ContractSummaryForLLM[];
  /** 수령액 대비 환수 노출 비율 0~1 — 금액 아님 */
  clawbackExposureRatio: number | null;
  /** 런웨이 개월수 — 금액 아님 */
  runwayMonths: number | null;
  /** 사용자의 설정값(선지급률 등) — 모델이 참조 가능한 유일한 실무 수치 */
  advanceRate: number;
}
