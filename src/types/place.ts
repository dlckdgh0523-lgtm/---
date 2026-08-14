/**
 * 사업장(접점) 도메인 타입.
 *
 * 설계 판단: Place(원본)와 PlaceView(파생)를 분리한다.
 * public/data/places.json에는 Place만 저장한다 — 경과개월·단계라벨을
 * 정적 파일에 구워 넣으면 배포 다음 날부터 값이 틀어진다(stale).
 * 파생값은 런타임에 licenseDate 기준으로 계산한다.
 */

/** 업종 분류 (대/중/소). 원천 데이터의 분류 체계를 그대로 보존한다. */
export interface BusinessCategory {
  large: string;
  medium: string;
  small: string;
}

/**
 * 경과 개월 기반 단계 라벨.
 * ⚠️ 구간 경계와 우선순위 전체가 [미검증 가설] — 현장 경험 기반, PRD §3 A4.
 * 구간 상수는 src/config/elapsed-stages.ts에 두어 조정 가능하게 한다.
 * 2026-08-13 사용자 확정: 갱신 도래 = 12±1개월(11~13), 14~23 = '1년차 경과'.
 * 이에 따라 관찰 구간을 7~10으로 조정 (원 기획 7~11 — 갱신 창과 겹침 제거, MEMORY.md 기록).
 */
export type ElapsedStage =
  | 'watching'   // 0–2개월: 관망 (개업 직후, 성사율 낮음)
  | 'priority'   // 3–6개월: 우선 접촉 (자리 잡히고 매출 감이 생기는 시점)
  | 'observing'  // 7–10개월: 관찰
  | 'renewal'    // 11–13개월: 갱신 도래 (12개월 ±1개월 창)
  | 'year-one'   // 14–23개월: 1년차 경과
  | 'recheck';   // 24개월 이상: 재점검

/**
 * 업종 → 추정 보장 니즈 태그.
 * ⚠️ 값(매핑 내용)은 보험 실무 지식 필요 — 코드가 채우지 않는다.
 * src/data/needs-map.ts(Phase 3)에 구조만 만들고 값은 TODO로 비워 사용자에게 요청한다.
 */
export interface NeedTag {
  code: string;        // 예: 'fire', 'liability' — 체계는 사용자 확정 대기
  label: string;       // 화면 표시명 (한국어)
  rationale?: string;  // 왜 이 업종에 이 니즈인가 — 사용자 작성
}

/** places.json에 저장되는 원본 레코드. 폐업 사업장은 파이프라인에서 이미 제외됨. */
export interface Place {
  id: string;
  name: string;                          // 상호명
  category: BusinessCategory;
  address: string;                       // 도로명 우선, 없으면 지번
  jibunAddress: string | null;           // 지번주소 원문 — 건축물대장 조인·건축HUB API 파라미터 파싱용
  adminDong: string | null;              // 동 이름 (인허가 데이터는 지번주소에서 파싱한 법정동 — 행정동 아님에 주의)
  lat: number;                           // WGS84 (EPSG:4326) 변환 완료 상태
  lng: number;
  licenseDate: string;                   // 인허가일자 'YYYY-MM-DD' — ⚠️ 실제 개업일과 다를 수 있음 (PRD §3 A5)
  source: 'localdata' | 'sbiz';          // localdata=지방행정 인허가, sbiz=소상공인 상가정보
  coordConverted: boolean;               // true면 EPSG:5174→4326 변환을 거침 (파이프라인 로그와 대응)
  /**
   * 재인허가(양수도·업종 전환) 의심 — 같은 (동,번,지)에서 유사 상호가 인허가 직전에 폐업한 기록.
   * 실측 규칙(달볶이 사례로 검증, 용산 최근 13개월 5.6%). 이 플래그가 있으면 "신규 개업"이 아니라
   * 기존 가게의 행정 재등록일 가능성이 높다 — 접점 우선순위·상세 패널 근거 표시에 사용.
   */
  suspectedRelicense?: { prevName: string; prevClosedAt: string; prevCategory: string };
}

/** 런타임 파생값. 목록/지도 렌더링 직전에 계산한다. */
export interface PlaceView extends Place {
  elapsedMonths: number;                 // 오늘 기준 인허가일로부터 경과 개월
  stage: ElapsedStage;
  estimatedNeeds: NeedTag[];             // needs-map 값이 비어 있으면 빈 배열 (UI는 '매핑 준비 중' 표시)
}
