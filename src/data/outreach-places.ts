/**
 * 서울시 실시간 도시데이터 장소 ↔ 시군구 매핑.
 * 지역별로 그 지역 장소만 보여준다 — 다른 지역에 용산 데이터를 중복 표시하지 않는다 (2026-08-13).
 *
 * '11170'(용산구)은 2026-08-13 사이트 내부 API로 121개 장소 전수 조사해 확정 (MEMORY.md).
 * 다른 시군구 매핑은 같은 방식으로 조사해 추가한다 — 임의 작성 금지.
 * ⚠️ 이 API는 서울시 관할 121곳만 제공한다 — 서울 외 지역은 원천 데이터 자체가 없다.
 */
export const OUTREACH_PLACES_BY_REGION: Record<string, readonly string[]> = {
  '11170': [
    '이태원역',
    '이태원 관광특구',
    '이태원 앤틱가구거리',
    '용산역',
    '용리단길',
    '삼각지역',
    '해방촌·경리단길',
    '국립중앙박물관·용산가족공원',
    '이촌한강공원',
    '노들섬',
  ],
};

export const ALL_OUTREACH_PLACES: readonly string[] = Object.values(OUTREACH_PLACES_BY_REGION).flat();
