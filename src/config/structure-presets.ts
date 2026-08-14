/**
 * 소속 구분(B 섹션) 선택 → 수수료 구조(C 섹션) 기본 프리셋.
 *
 * ⚠️ 현재 4구분 모두 동일한 예시값이다. 회사 구분별 실측 기준은 공개 데이터가 없고,
 * 추측으로 구분별 차이를 만들어 넣는 것은 금지 사항("보험 실무 수치를 추측으로 채우기 금지").
 * 로드맵 (PRD Phase 6): 익명 집계(사용자가 직접 입력한 'user' 값만)가 구분별 30건 이상 쌓이면
 * 그 중앙값으로 이 프리셋을 대체한다 — 데이터가 쌓일수록 도구가 좋아지는 구조.
 */
import { CASHFLOW_DEFAULTS } from './cashflow-defaults';
import type { AgentProfile, ClawbackBracket } from '@/types';

export interface StructurePreset {
  advanceRate: number;
  clawbackSchedule: ClawbackBracket[];
}

function defaultPreset(): StructurePreset {
  return {
    advanceRate: CASHFLOW_DEFAULTS.advanceRate,
    clawbackSchedule: CASHFLOW_DEFAULTS.clawbackSchedule.map((b) => ({ ...b })),
  };
}

export const STRUCTURE_PRESETS: Record<AgentProfile['companyTier'], StructurePreset> = {
  'captive-life': defaultPreset(),
  'captive-nonlife': defaultPreset(),
  'large-ga': defaultPreset(),
  'small-ga': defaultPreset(),
};
