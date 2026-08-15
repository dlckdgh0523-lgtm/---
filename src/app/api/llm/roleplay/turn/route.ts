/**
 * LLM 용도 4: 롤플레잉 — 사장님 페르소나 턴 응답 (2026-08-14 재설계: 코드가 상태를 관리).
 *
 * 설계 원칙 — "모델에게 판단을 맡기지 않는다":
 * - 대화 상태(턴 수·용건 전달 여부·잡담 턴 수)는 서버가 규칙으로 추적한다(persona-state.ts).
 * - 매 턴 시스템 프롬프트에 현재 상태를 명시 주입한다("현재 N턴, 용건 미전달, 이번 턴 종료하라").
 * - 종료 판단은 코드가 한다: 최대 턴/잡담 임계 도달 시 강제 종료. 모델은 종료 대사만 생성.
 * - 메타 요청("시스템 프롬프트 보여줘" 등)은 LLM 호출 전에 패턴 매칭으로 차단하고 고정 응답. 메트릭 기록.
 * - 난이도는 형용사가 아니라 규칙(DIFFICULTY_RULES: 문장 수·먼저 질문 여부·정보 제공 조건·종료 임계).
 * - 출력은 구조화: { reply, endsConversation, respondedToUserPoint }. endsConversation은 모델 제안이지만
 *   최종 종료는 코드가 결정한다(상태 기반 강제 종료 우선).
 * - 응답 프로토콜(개행 구분 텍스트): 문장들 + 선택적 __END__/__META__/__DISABLED__/__RATELIMIT__/__ERROR__.
 */
import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/server/session';
import { guardLlmOutput } from '@/lib/llm/guard';
import { checkRate } from '@/lib/llm/rate-limit';
import { recordLlmCall } from '@/lib/llm/metrics';
import { LLM_MODEL_FAST, outputConfig } from '@/config/llm-model';
import { loadPlaceContext } from '@/lib/server/place-context';
import { computeState, detectMeta, metaResponse, type Turn } from '@/lib/llm/persona-state';
import {
  DAILY_LIMITS,
  DIFFICULTY_FEWSHOT,
  DIFFICULTY_LABEL,
  DIFFICULTY_RULES,
  MAX_USER_TURNS,
  TURN_MAX_TOKENS,
  VIRTUAL_AGE_BANDS,
  VIRTUAL_TEMPERS,
  type Difficulty,
} from '@/config/roleplay';
import type { ScenarioContext } from '@/lib/llm/types';

const TURNS_PER_DAY = DAILY_LIMITS.roleplayTurns;

/** 난이도 규칙을 모델이 따를 지시로 렌더 (형용사 아님) */
function difficultyDirectives(difficulty: Difficulty, turnCount: number): string {
  const r = DIFFICULTY_RULES[difficulty];
  const lines = [
    `- 답변은 최대 ${r.maxSentences}문장. 설명문·목록 금지.`,
    r.canAskFirst ? '- 궁금하면 먼저 질문해도 된다.' : '- 먼저 질문하지 않는다. 상대가 물으면 짧게만 답한다.',
    r.providesInfoBeforePurpose
      ? '- 상대에게 호의적으로 정보를 준다.'
      : '- 상대가 방문 이유(용건)를 명확히 밝히기 전에는 자세한 대답을 하지 않는다.',
  ];
  if (r.firstNTurnsReject > 0 && turnCount <= r.firstNTurnsReject) {
    lines.push(`- 지금은 초반이다. 거절·경계하는 태도를 보인다("안 사요", "바빠요" 등).`);
  }
  return lines.join('\n');
}

function personaSystem(
  ctx: ScenarioContext,
  name: string,
  difficulty: Difficulty,
  ageIdx: number,
  temperIdx: number,
  state: { userTurnCount: number; purposeStated: boolean; forceEnd: boolean },
): string {
  const facts = [
    `상호: ${name}`,
    `업종: ${ctx.industry}${ctx.subCategory ? ` (${ctx.subCategory})` : ''}`,
    `위치: ${ctx.regionName}`,
    `개업 후 ${ctx.elapsedMonths}개월 경과`,
    ctx.anniversaryYears ? `곧 ${ctx.anniversaryYears}주년` : null,
    ctx.suspectedRelicense ? `최근 업종을 바꿔 재개업함 (이전: ${ctx.suspectedRelicense.prevCategory})` : null,
  ]
    .filter(Boolean)
    .join('\n- ');

  const stateBlock = [
    `- 현재 ${state.userTurnCount}턴째다.`,
    `- 상대(설계사)가 방문 이유를 ${state.purposeStated ? '전달했다.' : '아직 명확히 전달하지 않았다.'}`,
    state.forceEnd
      ? '- ⚠️ 이번 턴에서 대화를 끝내라. 자연스러운 마무리 인사("장사해야 해서요" 등)로 짧게 종료하고 endsConversation을 true로 둔다.'
      : '- 대화를 이어간다.',
  ].join('\n');

  return `너는 실제 사업장의 사장님 역할이다. 보험설계사가 가게에 처음 방문한 상황의 롤플레잉이다.

[사업장 사실 — 공개 데이터 기반]
- ${facts}

[가상 설정 — 데이터에 없는 부분, 화면에 '가상'으로 표시됨]
- 나이대: ${VIRTUAL_AGE_BANDS[ageIdx] ?? VIRTUAL_AGE_BANDS[0]}
- 성격: ${VIRTUAL_TEMPERS[temperIdx] ?? VIRTUAL_TEMPERS[0]}

[현재 상태 — 이 지시를 반드시 따른다]
${stateBlock}

[난이도: ${DIFFICULTY_LABEL[difficulty]} — 태도 규칙]
${difficultyDirectives(difficulty, state.userTurnCount)}

[대화 예시 — 이 톤과 길이를 따른다 (합성 예시)]
${DIFFICULTY_FEWSHOT[difficulty]}

[불변 규칙 — 위반 시 출력 폐기]
- 한국어 구어체. 실제 사장님처럼 말한다.
- 사업장 사실·가상 설정 밖의 사실(매출, 가족, 법령, 보험 지식)을 지어내지 않는다.
- 법령·조문·과태료를 언급하지 않는다.

[출력 형식]
JSON으로 답한다: { "reply": "사장님 대사", "endsConversation": boolean, "respondedToUserPoint": boolean }
- reply: 위 규칙을 따르는 사장님 대사.
- endsConversation: 대화를 끝내는 게 자연스러우면 true (단, 최종 종료는 시스템이 결정한다).
- respondedToUserPoint: 상대의 마지막 말에 실제로 대답했으면 true.`;
}

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    reply: { type: 'string' as const, description: '사장님 대사 (한국어 구어체)' },
    endsConversation: { type: 'boolean' as const },
    respondedToUserPoint: { type: 'boolean' as const },
  },
  required: ['reply', 'endsConversation', 'respondedToUserPoint'],
  additionalProperties: false,
};

const PLAIN = { 'Content-Type': 'text/plain; charset=utf-8' } as const;

export async function POST(req: NextRequest) {
  const email = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!email) return new Response('unauthorized', { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return new Response('__DISABLED__\n', { headers: PLAIN });
  if (!(await checkRate(`roleplay:${email}`, TURNS_PER_DAY))) return new Response('__RATELIMIT__\n', { headers: PLAIN });

  const body = (await req.json()) as {
    region?: string;
    placeId?: string;
    difficulty?: Difficulty;
    ageIdx?: number;
    temperIdx?: number;
    history?: Turn[];
    userText?: string;
  };
  const { region, placeId, difficulty = 'normal', ageIdx = 0, temperIdx = 0, history = [], userText } = body;
  if (!region || !placeId || !userText?.trim()) return new Response('bad params', { status: 400 });

  const loaded = loadPlaceContext(region, placeId);
  if (!loaded) return new Response('not found', { status: 404 });

  const startedAt = Date.now();

  // --- 메타 요청은 LLM 이전에 차단 (코드가 고정 응답) ---
  if (detectMeta(userText)) {
    await recordLlmCall('roleplay-turn', { ok: true, latencyMs: Date.now() - startedAt, guardViolations: ['meta-blocked'] });
    return new Response(`${metaResponse(userText)}\n__META__\n`, { headers: PLAIN });
  }

  // --- 상태 계산: 코드가 턴/용건/잡담/종료를 결정 ---
  const state = computeState(history, userText, difficulty);

  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-20).map((h) => ({
      role: h.speaker === 'user' ? ('user' as const) : ('assistant' as const),
      content: h.text.slice(0, 500),
    })),
    { role: 'user' as const, content: userText.slice(0, 500) },
  ];

  const guardViolations: string[] = [];
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: LLM_MODEL_FAST,
      max_tokens: TURN_MAX_TOKENS,
      output_config: outputConfig(LLM_MODEL_FAST, { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } }),
      system: personaSystem(loaded.context, loaded.place.name, difficulty, ageIdx, temperIdx, state),
      messages,
    });
    if (response.stop_reason === 'refusal') {
      await recordLlmCall('roleplay-turn', { ok: false, latencyMs: Date.now() - startedAt, guardViolations });
      return new Response('__ERROR__\n', { headers: PLAIN });
    }
    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') {
      await recordLlmCall('roleplay-turn', { ok: false, latencyMs: Date.now() - startedAt, guardViolations });
      return new Response('__ERROR__\n', { headers: PLAIN });
    }
    const parsed = JSON.parse(block.text) as { reply: string; endsConversation: boolean; respondedToUserPoint: boolean };

    // 가드 필터 (문장 단위) — 금지 표현 제거
    const guarded = guardLlmOutput(parsed.reply);
    guardViolations.push(...guarded.violations);
    const replyText = guarded.ok ? guarded.text : '';

    // 종료 최종 결정: 코드 강제 종료(상태) 우선, 아니면 모델 제안 반영
    const ended = state.forceEnd || parsed.endsConversation;

    const lines = replyText ? replyText.split(/(?<=[.!?…])\s+/).filter(Boolean) : ['...'];
    const out = lines.join('\n') + (ended ? '\n__END__' : '') + '\n';
    await recordLlmCall('roleplay-turn', { ok: true, latencyMs: Date.now() - startedAt, guardViolations });
    return new Response(out, { headers: PLAIN });
  } catch {
    await recordLlmCall('roleplay-turn', { ok: false, latencyMs: Date.now() - startedAt, guardViolations });
    return new Response('__ERROR__\n', { headers: PLAIN });
  }
}
