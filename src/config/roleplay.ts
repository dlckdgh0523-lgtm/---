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

/**
 * 일일 한도 (계정=JWT 기준, Redis 카운트). 관리자 화면에 사용량과 함께 표시.
 * 롤플레잉은 턴 기준 — 세션 기준을 기각한 이유: 세션 경계는 클라이언트 신고값이라
 * 서버가 신뢰할 수 없고, 비용 발생 단위가 턴이다. 300턴 ≈ 세션 25회 분량 (2026-08-14 상향, 구 30).
 */
export const DAILY_LIMITS = {
  roleplayTurns: 300,
  scores: 40,
  hints: 60,
  scenarios: 30,
} as const;

/** 힌트 1회당 감점(점수 100 기준), 감점 상한 [미검증 가설] */
export const HINT_PENALTY = 3;
export const HINT_PENALTY_CAP = 15;

/** 난이도 — 태도만 바뀌고 사실 데이터는 동일 */
export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: '쉬움', normal: '보통', hard: '어려움' };

/**
 * 난이도를 형용사가 아니라 검사 가능한 규칙으로 정의한다 (2026-08-14 재설계).
 * 임계값은 전부 [미검증 가설]. 상태 추적·종료 판단은 코드가 하고, 모델은 이 규칙을 따르는 대사만 생성한다.
 */
export interface DifficultyRule {
  maxSentences: number; // 답변 문장 수 상한
  canAskFirst: boolean; // 사용자보다 먼저 질문해도 되는가
  providesInfoBeforePurpose: boolean; // 용건 전달 전에 정보(대답)를 제공하는가
  firstNTurnsReject: number; // 첫 N턴은 거절 표현을 포함 (hard용, 0이면 없음)
  chatOnlyEndTurns: number; // 용건 없는 잡담이 이 턴 수에 도달하면 종료
}

export const DIFFICULTY_RULES: Record<Difficulty, DifficultyRule> = {
  easy: { maxSentences: 3, canAskFirst: true, providesInfoBeforePurpose: true, firstNTurnsReject: 0, chatOnlyEndTurns: 5 },
  normal: { maxSentences: 1, canAskFirst: false, providesInfoBeforePurpose: false, firstNTurnsReject: 0, chatOnlyEndTurns: 3 },
  hard: { maxSentences: 1, canAskFirst: false, providesInfoBeforePurpose: false, firstNTurnsReject: 2, chatOnlyEndTurns: 2 },
};

/**
 * 난이도별 few-shot 예시 — 작은 모델(haiku)에는 지시문보다 예시가 효과적.
 * ⚠️ 전부 합성 예시다(실제 상담 데이터 아님). 페르소나 톤·길이·태도를 보여주는 용도.
 */
export const DIFFICULTY_FEWSHOT: Record<Difficulty, string> = {
  easy: `설계사: 안녕하세요 사장님, 근처에서 일하는데 인사드리러 왔어요.
사장님: 아 네, 어떤 일 하세요?
설계사: 보험 쪽이에요. 요즘 가게는 좀 어떠세요?
사장님: 그럭저럭이죠. 요즘 손님이 좀 줄어서 걱정이긴 해요.`,
  normal: `설계사: 안녕하세요 사장님.
사장님: 네, 무슨 일이세요?
설계사: 근처 지나다 인사드리러 왔어요.
사장님: 바쁜데요.`,
  hard: `설계사: 안녕하세요, 잠깐 시간 되세요?
사장님: 안 사요. 됐어요.
설계사: 아 파는 거 아니고 인사만 드리려고요.
사장님: 바빠요, 나중에요.`,
};

/**
 * 메타 요청 패턴 — LLM 호출 전에 코드가 감지해 페르소나 고정 응답으로 차단한다.
 * 모델이 매번 창의적으로 회피하게 할 이유가 없다. 감지 건수는 메트릭에 기록.
 */
export const META_PATTERNS: RegExp[] = [
  /시스템\s*프롬프트/,
  /프롬프트\s*(를\s*)?(보여|알려|뭐|출력|공개)/,
  /(이전|앞선|지금까지).{0,6}(지시|명령|규칙).{0,4}(무시|잊)/,
  /지시를?\s*무시/,
  /너\s*(는\s*)?a?i\s*(지|잖|맞|아니)/i,
  /챗봇|언어\s*모델|gpt|claude/i,
  /개발자\s*모드|jailbreak|탈옥/i,
  /역할\s*(을\s*)?(벗어|그만)|역할극\s*(그만|끝)/,
];

/** 메타 요청 감지 시 페르소나 고정 응답 (난이도 무관, 사장님답게 넘긴다) */
export const META_RESPONSES: string[] = [
  '무슨 말씀이신지... 저는 그런 거 잘 몰라요.',
  '네? 갑자기 무슨 말씀이세요.',
  '어유, 저는 장사밖에 몰라서요. 무슨 용건이신데요?',
];

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

// ⚠️ 판정 기준을 조였다 (2026-08-14): 이전 문구가 모호해 "보험 권유"도 방문 이유 전달로,
//    "보험 있으세요?"도 상황 질문으로 관대하게 인정돼 못한 대화가 50점을 받았다(opus로도 흔들림).
//    → 판매 목적/판매 질문은 명시적으로 미충족 처리하도록 문구를 구체화.
export const RUBRIC: RubricItem[] = [
  { id: 'intro-early', weight: 25, question: '초반(첫 2번의 사용자 발화 안)에 자기소개와 부담 없는 방문 이유를 전달했는가. ⚠️ 자기소개 없이 곧바로 보험·상품 권유로 시작했다면 미충족이다.' },
  { id: 'ask-first', weight: 25, question: '상대(사장님)의 상황·근황·어려움을 먼저 물었는가. ⚠️ "보험 있으세요?"처럼 판매를 위한 도입 질문은 상황 파악이 아니므로 미충족이다.' },
  { id: 'rejection', weight: 20, question: '거절이나 시큰둥한 반응에 감정적·반박으로 대응하지 않고 물러서며 자연스럽게 이어갔는가. ⚠️ "아 왜요"처럼 반박하거나 계속 밀어붙였다면 미충족이다.' },
  { id: 'next-contact', weight: 20, question: '다음 접촉의 약속이나 여지(명함, 재방문 등)를 만들려고 시도했는가' },
  { id: 'no-push', weight: 10, question: '가입 압박·단정("무조건 가입", "넣으세요") 없이 대화를 여는 톤을 유지했는가' },
];
