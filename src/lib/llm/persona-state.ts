/**
 * 롤플레잉 대화 상태 — 서버(코드)가 추적한다. 모델에게 상태 관리를 맡기지 않는다 (2026-08-14 재설계).
 * 턴 수·용건 전달 여부·잡담 턴 수를 규칙으로 계산하고, 종료 판단도 코드가 한다.
 * 모델은 주입된 상태를 따르는 대사만 생성한다.
 */
import { DIFFICULTY_RULES, MAX_USER_TURNS, META_PATTERNS, META_RESPONSES, type Difficulty } from '@/config/roleplay';

export interface Turn {
  speaker: 'user' | 'owner';
  text: string;
}

/**
 * 용건(방문 이유) 전달 여부 — 규칙 1차 판정. 보험/상담/설계사/소개/가입/보장 등 업무 키워드가
 * 사용자 발화에 나타나면 용건을 꺼낸 것으로 본다. 애매하면 false(보수적) — 필요 시 호출부가 LLM 확인.
 */
const PURPOSE_KEYWORDS =
  /보험|상담|설계사|보장|가입|저축|연금|종신|실손|화재|배상|계약|상품\s*설명|플랜|재무|노후|은퇴|사고\s*대비/;

export function statedPurpose(userText: string): boolean {
  return PURPOSE_KEYWORDS.test(userText);
}

/** 메타 요청 감지 — LLM 호출 전에 코드가 차단 */
export function detectMeta(userText: string): boolean {
  return META_PATTERNS.some((re) => re.test(userText));
}

/** 메타 응답 고정 선택 — 랜덤 대신 길이 기반(결정론, Math.random 미사용) */
export function metaResponse(userText: string): string {
  return META_RESPONSES[userText.length % META_RESPONSES.length];
}

export interface DialogueState {
  userTurnCount: number; // 이번 발화 포함 사용자 턴 수
  purposeStated: boolean; // 지금까지(이번 발화 포함) 용건을 꺼냈는가
  chatOnlyTurns: number; // 용건 없이 지난 사용자 턴 수
  forceEnd: boolean; // 코드가 강제 종료해야 하는가
  forceEndReason: 'max-turns' | 'chat-only' | null;
}

/**
 * history(이전 대화) + 이번 userText로 상태를 계산한다.
 * forceEnd: 최대 턴 도달 또는 (난이도별) 용건 없는 잡담 임계 도달 시 코드가 종료를 강제.
 */
export function computeState(history: Turn[], userText: string, difficulty: Difficulty): DialogueState {
  const userTurns = history.filter((h) => h.speaker === 'user').map((h) => h.text);
  const allUserTexts = [...userTurns, userText];
  const userTurnCount = allUserTexts.length;
  const purposeStated = allUserTexts.some(statedPurpose);
  // 용건을 꺼내기 전까지의 잡담 턴 수 (용건이 나오면 잡담 카운트 종료)
  let chatOnlyTurns = 0;
  for (const t of allUserTexts) {
    if (statedPurpose(t)) break;
    chatOnlyTurns += 1;
  }
  const rule = DIFFICULTY_RULES[difficulty];
  const maxTurnsHit = userTurnCount >= MAX_USER_TURNS;
  const chatOnlyHit = !purposeStated && chatOnlyTurns >= rule.chatOnlyEndTurns;
  return {
    userTurnCount,
    purposeStated,
    chatOnlyTurns,
    forceEnd: maxTurnsHit || chatOnlyHit,
    forceEndReason: maxTurnsHit ? 'max-turns' : chatOnlyHit ? 'chat-only' : null,
  };
}
