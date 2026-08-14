/**
 * 업종 → 보장 니즈 매핑 (2026-08-13 상품 구조 재정의).
 *
 * 재정의된 관점: 접점의 대상은 사업장이 아니라 사업주(사람)다.
 * 사업장 정보는 그 사람에게 접근할 명분과 맥락을 제공하는 수단이며,
 * 실제 규모가 큰 영역은 사업주 개인 보장(건강·종신·연금)과 가족 확장이다.
 *
 * 구조:
 *   business        — 사업 관련 보장 (화재·배상책임 등). 진입 명분.
 *   personalContext — 이 업종의 사업주에게 개인 보장 대화를 여는 맥락
 *                     (예: 조리 화상 위험 → 상해, 1인 사업 → 소득 단절 대비).
 *   employeeGroup   — 직원이 있는 업종의 단체보험 맥락 (해당 시).
 *
 * ⚠️ 값은 전부 TODO — 보험 실무 지식이 필요하며 추측으로 채우지 않는다 (금지 사항).
 *    사용자(이창호)가 채울 때까지 UI는 "매핑 준비 중"으로 표시한다.
 * 키는 생존 분석·인허가 데이터의 업종 대분류와 동일해야 한다 (industry-risk.generated.json 참조).
 */
import type { NeedTag } from '@/types';

export interface IndustryNeeds {
  /** 사업 관련 보장 — 진입 명분 (화재, 배상책임 등) */
  business: NeedTag[];
  /** 사업주 개인 보장 진입 맥락 — 건강·상해, 종신, 연금 등으로 확장하는 대화 소재 */
  personalContext: NeedTag[];
  /** 직원 단체보험 맥락 (직원 고용이 일반적인 업종만) */
  employeeGroup?: NeedTag[];
}

/** TODO(이창호): 각 업종의 값을 채울 것. 빈 배열 = 매핑 준비 중 표시 */
export const NEEDS_MAP: Record<string, IndustryNeeds> = {
  일반음식점: { business: [], personalContext: [], employeeGroup: [] },
  휴게음식점: { business: [], personalContext: [], employeeGroup: [] },
  미용업: { business: [], personalContext: [] },
  세탁업: { business: [], personalContext: [] },
  당구장업: { business: [], personalContext: [] },
  노래연습장업: { business: [], personalContext: [] },
  숙박업: { business: [], personalContext: [], employeeGroup: [] },
  골프시설: { business: [], personalContext: [], employeeGroup: [] },
};

export function needsFor(industryLabel: string): IndustryNeeds | null {
  return NEEDS_MAP[industryLabel] ?? null;
}
