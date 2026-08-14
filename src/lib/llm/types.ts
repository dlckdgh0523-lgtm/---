/**
 * LLM 페이로드 타입 — 절대 원칙의 1차 방어 (2026-08-14 LLM 통합 설계).
 *
 * 이 파일의 타입에는 다음 필드가 "존재하지 않는다":
 *   금액 원본(수령액·현금·보험료·선지급액), API 키, 내부 경로, 다른 사용자 데이터.
 * 숫자는 전부 결정론적 코드가 계산해서 넣는다 — LLM은 계산하지 않고 해석·문장 생성만 한다.
 * 출력 필터(guard.ts)는 2차 방어일 뿐이다.
 */

/** 접근 시나리오 생성(용도 1)의 컨텍스트 — 공개 사업장 정보 + 실측 통계만 */
export interface ScenarioContext {
  regionName: string;            // "서울특별시 용산구"
  industry: string;              // 업종 대분류 (예: 일반음식점)
  subCategory: string | null;    // 업태 (예: 한식)
  elapsedMonths: number;         // 개업 후 경과 개월 (코드 계산)
  anniversaryYears: number | null; // N주년 도래 시 N, 아니면 null
  suspectedRelicense: { prevCategory: string; prevClosedAt: string } | null; // 업종 전환 근거
  /**
   * 해당 업종 24개월 폐업률(%) — 생존 분석 실측값. 표본 부족 업종은 null (수치 미제공).
   * LLM은 이 값을 그대로 인용만 할 수 있고 재계산·창작 금지.
   */
  industryClosure24Pct: number | null;
  // ⚠️ 법정 의무(화재배상책임 등) 필드는 의도적으로 없다 — 법령 API 캐시를 아직 보유하지 않아
  //    LLM이 조문·과태료를 지어낼 위험이 있으므로, 캐시 구축 전까지 컨텍스트에서 제외 (MEMORY.md)
}

export interface Scenario {
  angle: string; // 접근 각도 한 줄 (예: "주년 축하", "업종 통계", "동네 이웃")
  text: string;  // 첫 접근 문장
}

export type ScenarioLookup =
  | { status: 'ok'; scenarios: Scenario[]; note: string }
  | { status: 'disabled' }            // ANTHROPIC_API_KEY 미설정
  | { status: 'error'; message: string };
