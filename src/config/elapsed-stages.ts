/**
 * 경과 개월 → 단계 라벨 구간 정의.
 * ⚠️ 구간 경계와 우선순위 전체가 [미검증 가설] — 현장 경험 기반 (PRD §3 A4).
 * 2026-08-13 확정: 갱신 도래 = 12±1개월(11~13), 14~23 = '1년차 경과'.
 * 관찰 구간은 갱신 창과 겹치지 않게 7~10으로 조정 (원 기획 7~11과 다름, MEMORY.md).
 *
 * ⚠️ 전제 자체의 검증 계획 (PRD §3 A5): 인허가일자 ≈ 실개업일 표본 30건 대조,
 * 10% 이상 어긋나면 이 구간 전체를 재설계한다.
 */
import type { ElapsedStage } from '@/types';

export interface StageRule {
  stage: ElapsedStage;
  minMonth: number;
  maxMonth: number | null; // null = 상한 없음
  label: string;
  note: string;
}

export const ELAPSED_STAGE_RULES: StageRule[] = [
  { stage: 'watching', minMonth: 0, maxMonth: 2, label: '관망', note: '개업 직후는 여유가 없어 성사율이 낮음 [가설]' },
  { stage: 'priority', minMonth: 3, maxMonth: 6, label: '우선 접촉', note: '자리가 잡히고 매출 감이 생기는 시점 [가설]' },
  { stage: 'observing', minMonth: 7, maxMonth: 10, label: '관찰', note: '' },
  { stage: 'renewal', minMonth: 11, maxMonth: 13, label: '갱신 도래', note: '초기 가입 상품 갱신 시점 (12개월 ±1개월 창)' },
  { stage: 'year-one', minMonth: 14, maxMonth: 23, label: '1년차 경과', note: '' },
  { stage: 'recheck', minMonth: 24, maxMonth: null, label: '재점검', note: '' },
];

export function stageFor(elapsedMonths: number): StageRule {
  const found = ELAPSED_STAGE_RULES.find(
    (r) => elapsedMonths >= r.minMonth && (r.maxMonth === null || elapsedMonths <= r.maxMonth),
  );
  return found ?? ELAPSED_STAGE_RULES[ELAPSED_STAGE_RULES.length - 1];
}
