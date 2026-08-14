/**
 * 연령대 구성 → 가두 홍보 소구점 매핑 — 구조만 (needs-map과 별개).
 * ⚠️ 값은 전부 TODO — 보험 실무 지식이 필요하며 추측으로 채우지 않는다. 사용자(이창호)가 채운다.
 * 키는 서울시 citydata의 연령 필드(PPLTN_RATE_10 등) 10세 단위와 일치.
 */
export interface AgePitch {
  /** 이 연령대가 주류일 때의 소구점 (대화 여는 문장·상품 방향) */
  pitches: string[];
}

/** TODO(이창호): 값 채우기. 빈 배열 = 화면에 '소구점 준비 중' 표시 */
export const AGE_PITCH: Record<string, AgePitch> = {
  '10': { pitches: [] },
  '20': { pitches: [] },
  '30': { pitches: [] },
  '40': { pitches: [] },
  '50': { pitches: [] },
  '60': { pitches: [] },
  '70': { pitches: [] },
};
