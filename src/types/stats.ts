/**
 * 익명 집계 전송 페이로드 — 서버로 나가는 '유일한' 사용자 유래 데이터.
 * 기본 OFF, 사용자가 옵트인해야 전송 (PRD §8.2).
 *
 * 전송 금지 (타입에 아예 존재하지 않게 설계):
 *   금액, 잔고, 이름, 연락처, 계약자 정보, 위치 이력.
 * 이 타입에 number 필드를 추가할 때는 '비율 또는 구간인지' 반드시 검토할 것.
 */
import type { Affiliation, ClawbackBracket, ProductLine, AgentProfile } from './agent';
import type { RiskLevel } from './contract';

export interface AnonymousStat {
  schemaVersion: 1;
  affiliation: Affiliation;
  companyTier: AgentProfile['companyTier'];
  /**
   * 선지급률 — 비율(0~1)이므로 전송 가능.
   * ⚠️ structureSource가 'user'인 경우에만 포함 (2026-08-13 설계 변경).
   * 기본값을 그대로 집계하면 "기본값이 기본값을 강화"하는 순환 — GIGO.
   */
  advanceRate?: number;
  /** 환수 구간 설정 — 구조값이므로 전송 가능. 위와 동일하게 'user' 값만 포함 */
  clawbackSchedule?: ClawbackBracket[];
  mainProductLine: ProductLine;
  /** 상품 구분별 위험도 분포 — 건수만, 금액 없음 */
  riskDistribution: Record<RiskLevel, number>;
  sentAt: string;
}
