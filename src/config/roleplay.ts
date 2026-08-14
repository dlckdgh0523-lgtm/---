/**
 * 롤플레잉 상수 — rubric은 코드에 고정한다. LLM이 기준을 만들지 않는다.
 * 판정(각 기준 충족 여부 + 전사 인용)은 LLM이 하고, 점수 합산은 코드가 한다 (README 정직 기록).
 * ⚠️ 아래 모든 수치는 [미검증 가설, 조정 가능].
 */

/** 발화 종료 감지 무음 타이머(ms) — onspeechend에 의존하지 않는다 [미검증 가설] */
export const SILENCE_END_MS = 1800;

/** 이 값 미만 confidence의 발화는 채점 근거에서 제외하고 리뷰에 '인식 신뢰도 낮음' 표시 [미검증 가설] */
export const CONFIDENCE_MIN = 0.6;

/** 세션 전체 인식 실패율(저신뢰 비율)이 이 값 이상이면 채점 결과에 신뢰도 경고 [미검증 가설] */
export const RECOGNITION_FAIL_WARN_RATE = 0.3;

/** 자원 통제: 세션당 최대 사용자 턴 수 / 턴당 응답 토큰 상한 [미검증 가설] */
export const MAX_USER_TURNS = 12;
export const TURN_MAX_TOKENS = 400;

/** 힌트 1회당 감점(점수 100 기준), 감점 상한 [미검증 가설] */
export const HINT_PENALTY = 3;
export const HINT_PENALTY_CAP = 15;

/** 난이도 — 태도만 바뀌고 사실 데이터는 동일 */
export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: '쉬움', normal: '보통', hard: '어려움' };

/** 가상 설정 후보 — 클라이언트는 인덱스만 보내고 서버가 문자열로 변환 (프롬프트 인젝션 차단) */
export const VIRTUAL_AGE_BANDS = ['30대', '40대', '50대', '60대'] as const;
export const VIRTUAL_TEMPERS = ['무뚝뚝하지만 정 많음', '싹싹하지만 계산 빠름', '조심스럽고 신중함', '호탕하고 직설적'] as const;

/**
 * 채점 rubric — 코드 고정. 법정 의무 항목은 법령 API 미도입 결정(2026-08-14)으로 제외.
 * 가중치 합 100. 전부 [미검증 가설].
 */
export interface RubricItem {
  id: string;
  weight: number;
  question: string; // LLM에게 판정을 요청할 기준 문장
}

export const RUBRIC: RubricItem[] = [
  { id: 'intro-early', weight: 25, question: '초반(첫 2번의 사용자 발화 안)에 방문 이유를 전달했는가' },
  { id: 'ask-first', weight: 25, question: '상대(사장님)의 상황을 물었는가, 아니면 일방적으로 설명만 했는가 (물었으면 충족)' },
  { id: 'rejection', weight: 20, question: '거절이나 시큰둥한 반응에 감정적으로 대응하지 않고 자연스럽게 대화를 이어갔는가' },
  { id: 'next-contact', weight: 20, question: '다음 접촉의 약속이나 여지(명함, 재방문 등)를 만들려고 시도했는가' },
  { id: 'no-push', weight: 10, question: '가입 압박·단정 없이 대화를 여는 톤을 유지했는가' },
];
