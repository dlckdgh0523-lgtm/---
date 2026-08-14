/**
 * 업종 → 보장 니즈 매핑 (2026-08-14 채움).
 *
 * ⚠️ 출처 (가장 중요): 이 매핑은 **법령과 공개 자료 조사**에 기반한 것이며,
 *    작성자(이창호)의 현장 영업 경험에서 나온 것이 아니다. 실무 검증이 필요하다.
 *    - basis: 'statutory' 항목은 근거 법령(statuteRef)이 있는 법정 의무보험.
 *    - basis: 'general' 항목은 업종 특성상 통상 검토되는 항목으로, 근거는 일반적 판단이다.
 *
 * 재정의된 관점: 접점의 대상은 사업장이 아니라 사업주(사람)다.
 *   business        — 사업 관련 보장. 진입 명분.
 *   personalContext — 사업주 개인 보장 대화를 여는 맥락.
 *   employeeGroup   — 직원이 있는 업종의 단체보험 맥락.
 *
 * 법정 근거 (다중이용업소법 §13의2, 시행령 §2): 대상 업소 업주는 화재배상책임보험 가입 의무,
 *   미가입 시 최대 300만 원 과태료. 화재로 타인이 사·상하거나 재산 손해를 입으면 업주 무과실도
 *   피해자 배상 책임. 일반 화재보험과 보장 범위가 달라 별도 가입. 신규 사업장은 영업 개시 전 가입.
 *   보험금액(시행령 §9의3): 사망 시 피해자 1명당 1.5억 범위(손해액 2천만 미만이면 2천만), 부상 별표.
 *   ⚠️ 음식점 계열은 층·면적에 따라 대상 여부가 갈린다는 자료가 있으나 자료마다 서술이 달라
 *      확정하지 않는다 → conditional: true + "관할 소방서 확인 필요" 안내를 함께 노출.
 *
 * 키는 industry-risk.generated.json의 업종 대분류와 동일.
 */
import type { NeedTag } from '@/types';

export interface IndustryNeeds {
  business: NeedTag[];
  personalContext: NeedTag[];
  employeeGroup?: NeedTag[];
}

const DMLA = '다중이용업소법 제13조의2 및 시행령 제2조'; // 화재배상책임보험 근거

export const NEEDS_MAP: Record<string, IndustryNeeds> = {
  일반음식점: {
    business: [
      { code: 'fire-liability', label: '화재배상책임보험', basis: 'statutory', conditional: true, statuteRef: DMLA, rationale: '다중이용업 대상 시 의무. 층·면적 조건에 따라 대상 여부가 갈림' },
      { code: 'fire-property', label: '화재보험(재산)', basis: 'general', rationale: '시설·집기·재고 손해' },
      { code: 'food-liability', label: '음식물배상책임', basis: 'general', rationale: '식중독 등 음식물 사고' },
      { code: 'gas-liability', label: '가스사고배상책임', basis: 'general', rationale: '가스 사용 시설' },
    ],
    personalContext: [
      { code: 'income-gap', label: '소득 보장(자영업자)', basis: 'general', rationale: '소득 중단 시 대체 수입원이 없음' },
      { code: 'accident-health', label: '상해·실손', basis: 'general', rationale: '근로자 지위가 아니어서 산재 적용 범위가 다름' },
    ],
    employeeGroup: [{ code: 'group-accident', label: '단체상해', basis: 'general', rationale: '직원 고용 시 검토' }],
  },
  휴게음식점: {
    business: [
      { code: 'fire-liability', label: '화재배상책임보험', basis: 'statutory', conditional: true, statuteRef: DMLA },
      { code: 'fire-property', label: '화재보험(재산)', basis: 'general' },
      { code: 'facility-liability', label: '시설소유관리자 배상책임', basis: 'general' },
    ],
    personalContext: [
      { code: 'income-gap', label: '소득 보장(자영업자)', basis: 'general', rationale: '소득 중단 시 대체 수입원이 없음' },
      { code: 'accident-health', label: '상해·실손', basis: 'general', rationale: '산재 적용 범위가 다름' },
    ],
    employeeGroup: [{ code: 'group-accident', label: '단체상해', basis: 'general', rationale: '아르바이트 다수인 경우' }],
  },
  노래연습장업: {
    business: [
      { code: 'fire-liability', label: '화재배상책임보험', basis: 'statutory', statuteRef: DMLA, rationale: '시행령상 명시 업종' },
      { code: 'fire-property', label: '화재보험(재산)', basis: 'general', rationale: '방음재·음향장비' },
    ],
    personalContext: [{ code: 'late-hours', label: '상해·건강(심야 영업)', basis: 'general', rationale: '심야 영업 시간대 특성' }],
    employeeGroup: [{ code: 'group-accident', label: '단체상해', basis: 'general', rationale: '야간 근무자' }],
  },
  골프시설: {
    business: [
      { code: 'fire-liability', label: '화재배상책임보험', basis: 'statutory', statuteRef: DMLA, rationale: '실내 골프연습장업은 시행령상 대상' },
      { code: 'facility-liability', label: '시설소유관리자 배상책임', basis: 'general', rationale: '타구 사고 등' },
    ],
    personalContext: [{ code: 'customer-mix', label: '고객층 특성(검증 필요)', basis: 'general', rationale: '고객층 기반 소구 — 검증 필요' }],
    employeeGroup: [{ code: 'group-accident', label: '단체상해', basis: 'general', rationale: '검토' }],
  },
  미용업: {
    business: [
      { code: 'not-dmla', label: '다중이용업 대상 아님 — 화재배상책임보험 의무 없음', basis: 'general', rationale: '의무 대상이 아님을 명시' },
      { code: 'fire-property', label: '화재보험(재산)', basis: 'general' },
      { code: 'biz-liability', label: '영업배상책임', basis: 'general', rationale: '시술 관련 분쟁' },
    ],
    personalContext: [{ code: 'solo-income', label: '소득 보장(1인 운영)', basis: 'general', rationale: '1인 운영 비중이 높아 본인 소득 중단 위험이 큼' }],
    employeeGroup: [{ code: 'group-accident', label: '단체상해', basis: 'general', rationale: '스태프 있는 경우' }],
  },
  세탁업: {
    business: [
      { code: 'not-dmla', label: '다중이용업 대상 아님', basis: 'general', rationale: '의무 대상이 아님을 명시' },
      { code: 'fire-property', label: '화재보험(재산)', basis: 'general', rationale: '유기용제 취급' },
      { code: 'biz-liability', label: '영업배상책임', basis: 'general', rationale: '고객 물품 손상' },
    ],
    personalContext: [{ code: 'solo-income', label: '소득 보장(1인 운영)', basis: 'general', rationale: '1인 운영 비중' }],
    employeeGroup: [{ code: 'group-accident', label: '단체상해', basis: 'general', rationale: '검토' }],
  },
  // 숙박업·당구장업: 지시에 매핑이 주어지지 않았고 다중이용업 대상 여부가 자료마다 달라
  // 추측으로 채우지 않는다 → 빈 배열 유지("매핑 준비 중" 표시).
  숙박업: { business: [], personalContext: [], employeeGroup: [] },
  당구장업: { business: [], personalContext: [] },
};

export function needsFor(industryLabel: string): IndustryNeeds | null {
  return NEEDS_MAP[industryLabel] ?? null;
}
