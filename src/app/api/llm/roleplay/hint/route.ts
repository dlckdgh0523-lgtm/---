/**
 * 힌트 — 사용자가 버튼을 눌렀을 때만 다음 발화 후보 2~3개 제시.
 * 상시 노출 금지(훈련이 객관식이 되는 것 방지) — 호출 자체가 옵트인이며, 사용 횟수는
 * 클라이언트가 세어 채점에 감점으로 반영된다 (숙련도 지표).
 */
import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/server/session';
import { DAILY_LIMITS } from '@/config/roleplay';
import { guardLlmOutput } from '@/lib/llm/guard';
import { recordLlmCall } from '@/lib/llm/metrics';
import { checkRate } from '@/lib/llm/rate-limit';
import { loadPlaceContext } from '@/lib/server/place-context';

const HINTS_PER_DAY = DAILY_LIMITS.hints; // config 단일 출처

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    candidates: { type: 'array' as const, items: { type: 'string' as const } },
  },
  required: ['candidates'],
  additionalProperties: false,
};

export async function POST(req: NextRequest) {
  const email = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!email) return Response.json({ status: 'error', message: '로그인이 필요합니다' }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ status: 'disabled' });
  if (!(await checkRate(`hint:${email}`, HINTS_PER_DAY))) return Response.json({ status: 'error', message: '힌트 한도 초과' }, { status: 429 });

  const startedAt = Date.now();
  try {
    const { region, placeId, history = [] } = (await req.json()) as {
      region?: string;
      placeId?: string;
      history?: { speaker: 'user' | 'owner'; text: string }[];
    };
    if (!region || !placeId) return Response.json({ status: 'error', message: 'bad params' }, { status: 400 });
    const loaded = loadPlaceContext(region, placeId);
    if (!loaded) return Response.json({ status: 'error', message: 'not found' }, { status: 404 });

    const transcript = history.slice(-10).map((h) => `${h.speaker === 'user' ? '설계사' : '사장님'}: ${h.text.slice(0, 300)}`).join('\n');
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1024,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      system:
        '너는 보험설계사 방문 상담 코치다. 지금 상황에서 설계사가 할 수 있는 다음 한마디 후보 2~3개를 제시한다. 서로 다른 방향(질문형/공감형/용건형)으로, 각 1~2문장, 자연스러운 존댓말. 법령·조문 언급 금지, 가입 압박 금지, 컨텍스트에 없는 숫자 금지.',
      messages: [
        {
          role: 'user',
          content: `사업장: ${loaded.place.name} (${loaded.context.industry}, 개업 ${loaded.context.elapsedMonths}개월)\n\n대화:\n${transcript || '(아직 대화 없음 — 첫마디 후보)'}\n\n다음 발화 후보를 만들어라.`,
        },
      ],
    });
    if (response.stop_reason === 'refusal') return Response.json({ status: 'error', message: '생성 거부' });
    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return Response.json({ status: 'error', message: '파싱 실패' });
    const guarded = (JSON.parse(block.text) as { candidates: string[] }).candidates.map((c) => guardLlmOutput(c));
    const candidates = guarded.filter((g) => g.ok).map((g) => g.text).slice(0, 3);
    await recordLlmCall('hint', {
      ok: candidates.length > 0,
      latencyMs: Date.now() - startedAt,
      guardViolations: guarded.flatMap((g) => g.violations),
    });
    return Response.json({ status: 'ok', candidates });
  } catch (e) {
    await recordLlmCall('hint', { ok: false, latencyMs: Date.now() - startedAt });
    return Response.json({ status: 'error', message: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
