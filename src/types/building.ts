/**
 * 건축물대장(국토교통부 건축HUB) 온디맨드 조회 결과.
 * 전체 조인 금지 — 사용자가 특정 사업장을 클릭했을 때만 조회하고 캐시한다 (Phase 4).
 * 해석 로직(이 정보가 보장 판단에 왜 영향을 주는가)은 사용자가 채운다 — 코드는 구조만.
 */
export interface BuildingInfo {
  placeId: string;
  mainStructure: string | null;      // 주구조 (예: 철근콘크리트구조)
  roofStructure: string | null;      // 지붕
  buildingArea: number | null;       // 건축면적 ㎡
  totalFloorArea: number | null;     // 연면적 ㎡
  floorsAbove: number | null;        // 지상층수
  floorsBelow: number | null;        // 지하층수
  mainUse: string | null;            // 주용도
  approvalDate: string | null;       // 사용승인일 'YYYY-MM-DD'
  /** ⚠️ 건축HUB 표제부가 내진 여부를 직접 제공하는지 미확인 (MEMORY.md) — 미제공이면 항상 null */
  earthquakeResistant: boolean | null;
  fetchedAt: string;                 // 캐시 시각 ISO — 재조회 판단용
}

/** 조회 실패 시 앱이 죽지 않도록 결과를 판별 유니온으로 감싼다 (graceful degradation). */
export type BuildingLookup =
  | { status: 'ok'; data: BuildingInfo }
  | { status: 'not_found'; placeId: string }        // 주소 매칭 실패 — 흔한 케이스로 취급
  | { status: 'error'; placeId: string; message: string }
  | { status: 'disabled' };                          // API 키 미설정 — 기능 비활성 안내
