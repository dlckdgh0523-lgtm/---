/**
 * 설계사 온보딩 프로필.
 * ⚠️ 개인정보 원칙 (2026-08-14 확정): 금액성 필드(PROFILE_MONEY_FIELDS)는 서버에
 * 클라이언트 암호화 블롭(moneyEnc)으로만 저장된다 — 서버는 평문 금액을 보관하지 않는다.
 * 비금액 필드(지역·소속·상품·수수료 구조)는 집계용으로 평문 유지 (비식별).
 * 익명 집계는 stats.ts의 AnonymousStat으로만, 옵트인 시에만.
 * 금액 단위: 만원 (전 필드 공통).
 */

export type Affiliation = 'captive' | 'ga'; // 전속 / GA

/** 주력 상품 구분 — 2026-08-13 사용자 확정 5구분 */
export type ProductLine =
  | 'life'       // 생명
  | 'third'      // 제3보험 (건강·상해)
  | 'general'    // 손해 (일반)
  | 'auto'       // 자동차
  | 'savings';   // 저축성

/**
 * 환수 구간: 유지 개월수별 환수 비율.
 * ⚠️ 하드코딩 금지 — 사용자가 수정 가능한 설정값. 기본값은 예시이며
 * 실제 조건은 소속사·상품별로 다름을 화면과 주석에 명시한다.
 */
export interface ClawbackBracket {
  maxMonth: number;      // 이 개월수 이하 유지 후 실효 시
  clawbackRate: number;  // 선지급분 대비 환수 비율 0~1
}

export interface AgentProfile {
  /**
   * 지난 3개월 수수료 수령액의 평균 (만원) — 로컬 전용.
   * (2026-08-13 화면 개편: 월별 3칸 → 평균 1칸. 구 프로필은 storage.ts에서 평균으로 마이그레이션)
   */
  avgCommission3m: number;
  /** 현재 보유 현금 (대략) — 로컬 전용 */
  cashOnHand: number;
  /**
   * 월 고정지출 (2026-08-13 승인) — 한 칸: "월세·대출·생활비 포함".
   * 기본값 = 지난 3개월 수수료 평균 × 0.7 제안, 슬라이더로 조정.
   * 런웨이 = (보유 현금 + 권장 유보액) ÷ 월 고정지출.
   */
  monthlyFixedExpense: number;
  /**
   * 활동 지역 = 시군구코드 5자리 (2026-08-13 지역 아키텍처 개편).
   * 지역 데이터 팩(public/data/regions/{code}/)의 키이자 건축HUB API의 sigunguCd.
   * 데이터 팩이 없는 지역도 선택 가능 — 접점 리스트만 비고 계산기는 동작.
   * 구 프로필의 'yongsan'은 storage.ts에서 '11170'(용산구)으로 마이그레이션.
   */
  region: string;
  affiliation: Affiliation;
  /**
   * 소속사 구분 — 회사명이 아닌 구분값(익명 집계용).
   * ⚠️ 값 체계 미확정 (PRD §9-5). 임시: 대형GA / 중소GA / 전속-생보 / 전속-손보
   */
  companyTier: 'large-ga' | 'small-ga' | 'captive-life' | 'captive-nonlife';
  /** 선지급률 0~1. 기본 0.65 (60~70% 관행의 중앙값 — 근거는 PRD §1, 분포는 [미확인]) */
  advanceRate: number;
  mainProductLine: ProductLine;
  /** 이번 달 목표 (만원) */
  monthlyGoal: number;
  /**
   * 회사가 제시한 권장 최소치 (만원).
   * 회사 요구와 개인 재무 안전의 충돌 지점을 드러내는 데 사용 —
   * 최소치를 맞추려 무리한 계약을 넣으면 그 자체가 환수 위험 (결과 화면에서 연결).
   */
  companyMinimum: number;
  /** 환수 구간 설정 — 사용자 수정 가능, 기본값은 예시 */
  clawbackSchedule: ClawbackBracket[];
  /**
   * 구조값 출처 (2026-08-13 설계 변경 — MEMORY.md):
   * 'default' = 기본값 사용 중(결과는 추정치로 표시), 'user' = 사용자가 자기 명세서를 보고 입력.
   * 익명 집계 옵트인 시에도 'user'인 값만 전송 대상이 된다.
   */
  structureSource: {
    advanceRate: 'default' | 'user';
    clawbackSchedule: 'default' | 'user';
  };
  /** 익명 집계 전송 동의 — 기본 false (옵트인) */
  optInAnonymousStats: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 서버에 평문으로 두지 않는 금액성 필드 (2026-08-14 지시) — 서버는 수신 시 이 필드들을 능동 삭제한다 */
export const PROFILE_MONEY_FIELDS = [
  'avgCommission3m',
  'cashOnHand',
  'monthlyFixedExpense',
  'monthlyGoal',
  'companyMinimum',
] as const;

export type ProfileMoneyField = (typeof PROFILE_MONEY_FIELDS)[number];
export type ProfileMoney = Pick<AgentProfile, ProfileMoneyField>;

/** 서버 저장 형태 — 금액은 moneyEnc(클라이언트 AES-GCM 암호문)로만 */
export type StoredProfile = Omit<AgentProfile, ProfileMoneyField> & { moneyEnc?: string };
