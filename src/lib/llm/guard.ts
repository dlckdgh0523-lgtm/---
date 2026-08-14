/**
 * LLM 출력 필터 — 2차 방어 공통 모듈 (모든 LLM 기능이 이 하나를 쓴다. 기능별로 따로 만들지 않는다).
 * 1차 방어는 types.ts: 애초에 비밀·금액을 프롬프트에 주지 않는 것.
 *
 * 차단 계층:
 *  A. 하드 차단(출력 전체 폐기): API 키 형태, 내부 경로, 환경변수명 패턴
 *  B. 문장 제거: 재무 권고 표현, 가입 여부 단정, 법령 인용(캐시 미보유 — 언급 자체를 제거)
 */

export interface GuardResult {
  ok: boolean;          // false = 하드 차단 또는 제거 후 내용 없음 → 재시도/폐기
  text: string;         // 필터 통과한 텍스트
  violations: string[]; // 감지 내역 (로그용 — 사용자에게는 미노출)
}

/** A. 하드 차단 패턴 — 하나라도 걸리면 출력 전체 폐기 */
const HARD_BLOCK: { name: string; re: RegExp }[] = [
  { name: 'api-key-shape', re: /sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|whsec_[A-Za-z0-9]{8,}/ },
  { name: 'env-var-name', re: /\b(ANTHROPIC|RESEND|SESSION_SECRET|BUILDING_HUB|SEOUL_DATA|CRON_SECRET)[A-Z_]*\b/ },
  { name: 'internal-path', re: /[A-Z]:\\\\?Users|\/home\/\w+|\/etc\/|node_modules|\.env\b|localhost:\d+/ },
];

/** B. 문장 단위 제거 패턴 */
const SENTENCE_BLOCK: { name: string; re: RegExp }[] = [
  // 재무 권고 ("얼마를 저축하세요" 류) — 이 앱의 문구 원칙과 동일
  { name: 'financial-advice', re: /(저축|투자|납입|적립)\s*하(세요|십시오|시는 게|는 것이 좋)/ },
  { name: 'financial-advice-amount', re: /만\s?원(을|은|정도)?\s*(모으|저축|넣|남기)/ },
  // 가입 여부 단정
  { name: 'push-signup', re: /(꼭|반드시|무조건|지금 바로)\s*.{0,8}(가입|계약)/ },
  { name: 'push-signup-2', re: /가입(해야|하셔야|하시라)/ },
  // 법령 인용 — 법령 API 캐시 미보유이므로 조문·과태료·의무 언급은 전부 제거 (지어내기 방지)
  { name: 'legal-claim', re: /(제\s?\d+\s?조|과태료|벌금|의무\s?보험|의무적으로|법령|시행령|시행규칙|다중이용업소|화재배상책임)/ },
];

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?요다])\s+/).filter((s) => s.trim().length > 0);
}

export function guardLlmOutput(raw: string): GuardResult {
  const violations: string[] = [];

  for (const { name, re } of HARD_BLOCK) {
    if (re.test(raw)) {
      return { ok: false, text: '', violations: [`hard:${name}`] };
    }
  }

  const kept: string[] = [];
  for (const sentence of splitSentences(raw)) {
    const hit = SENTENCE_BLOCK.find(({ re }) => re.test(sentence));
    if (hit) violations.push(`sentence:${hit.name}`);
    else kept.push(sentence);
  }

  const text = kept.join(' ').trim();
  return { ok: text.length > 0, text, violations };
}
