/**
 * LLM 용도 1: 접점 접근 시나리오 생성 — 첫 접근 문장 3개를 서로 다른 각도로.
 *
 * 절대 원칙 준수:
 * - 컨텍스트(ScenarioContext)는 서버가 결정론적으로 만든다. 금액·키·경로 필드는 타입에 없다.
 * - LLM은 주어진 수치(업종 폐업률)만 인용 가능, 재계산·법령 언급·가입 단정 금지 (시스템 프롬프트 + guard 2차 방어).
 * - 로그인 필수 + 세션 기준 레이트 리밋 (자원 통제).
 * - ANTHROPIC_API_KEY 미설정 시 'disabled' — 앱은 죽지 않는다.
 */
import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import { DAILY_LIMITS } from '@/config/roleplay';
import { SESSION_COOKIE, verifySession } from '@/lib/server/session';
import { guardLlmOutput } from '@/lib/llm/guard';
import { LLM_MODEL_ACCURATE, outputConfig } from '@/config/llm-model';
import { checkRate } from '@/lib/llm/rate-limit';
import { recordLlmCall } from '@/lib/llm/metrics';
import { loadPlaceContext } from '@/lib/server/place-context';
import type { Scenario, ScenarioLookup } from '@/lib/llm/types';

const RATE_LIMIT = DAILY_LIMITS.scenarios; // config 단일 출처

const SYSTEM_PROMPT = `너는 저연차 보험설계사의 현장 코치다. 사업장에 처음 방문할 때 쓸 "첫 접근 문장" 3개를 서로 다른 각도로 만든다.

규칙 (위반 시 출력이 폐기된다):
- 컨텍스트에 주어진 수치만 그대로 인용한다. 어떤 숫자도 새로 만들거나 계산하지 않는다.
- ⚠️ 수치는 **반올림·근사·어림 없이 주어진 값 그대로** 쓴다. 폐업률이 16%면 정확히 "16%"라고 쓰고 "15%"나 "약 16%"로 바꾸지 않는다. 개월수·연수도 마찬가지다.
- ⚠️ **구체적 연도(예: "2024년", "올해")를 계산하거나 언급하지 마라.** 현재가 몇 년인지 알 수 없다. 시간은 "개업 N개월", "N주년"처럼 컨텍스트에 주어진 상대 표현으로만 쓴다.
- 법령·조문·과태료·의무보험을 언급하지 않는다. 검증된 법령 데이터가 제공되지 않았다.
- 가입을 단정하거나 압박하지 않는다 ("꼭 가입하셔야" 금지). 보험 언급 자체를 최소화하고, 대화를 여는 것이 목적이다.
- 금액 권고를 하지 않는다.
- 각 문장은 실제로 입 밖에 낼 수 있는 자연스러운 한국어 존댓말 1~3문장. 과장·아부 금지.
- 업종 전환 정보가 있으면 "새 단장"의 맥락으로만, 폐업률 수치가 있으면 위협이 아니라 공감의 맥락으로만 쓴다.`;

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    scenarios: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          angle: { type: 'string' as const, description: '접근 각도 요약 (5단어 이내)' },
          text: { type: 'string' as const, description: '첫 접근 문장 (한국어 존댓말)' },
        },
        required: ['angle', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['scenarios'],
  additionalProperties: false,
};

export async function POST(req: NextRequest) {
  const email = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!email) return Response.json({ status: 'error', message: '로그인이 필요합니다' } satisfies ScenarioLookup, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ status: 'disabled' } satisfies ScenarioLookup);
  if (!(await checkRate(`scenario:${email}`, RATE_LIMIT))) {
    return Response.json({ status: 'error', message: '오늘 생성 한도에 도달했습니다. 내일 다시 시도하세요.' } satisfies ScenarioLookup, { status: 429 });
  }

  const startedAt = Date.now();
  const guardViolations: string[] = [];
  try {
    const { region, placeId } = (await req.json()) as { region?: string; placeId?: string };
    if (!region || !placeId) {
      return Response.json({ status: 'error', message: 'bad params' } satisfies ScenarioLookup, { status: 400 });
    }
    // 컨텍스트는 서버가 결정론적으로 구성 — 클라이언트 입력은 식별자뿐 (공용 로더)
    const loaded = loadPlaceContext(region, placeId);
    if (!loaded) return Response.json({ status: 'error', message: '사업장을 찾을 수 없습니다' } satisfies ScenarioLookup, { status: 404 });
    const { context } = loaded;

    const client = new Anthropic();
    const response = await client.messages.create({
      model: LLM_MODEL_ACCURATE, // 폐업률 정확 인용 필요 — opus (지연 무관)
      max_tokens: 2048,
      output_config: outputConfig(LLM_MODEL_ACCURATE, { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } }),
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `사업장 컨텍스트(이 수치 외에는 어떤 숫자도 쓰지 마라):\n${JSON.stringify(context, null, 2)}\n\n서로 다른 각도의 첫 접근 문장 3개를 만들어라.`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      return Response.json({ status: 'error', message: '생성이 거부되었습니다. 다시 시도하세요.' } satisfies ScenarioLookup);
    }
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return Response.json({ status: 'error', message: '응답 파싱 실패' } satisfies ScenarioLookup);
    }

    const parsed = JSON.parse(textBlock.text) as { scenarios: Scenario[] };
    // 2차 방어: 시나리오별 출력 필터 — 위반 문장 제거, 하드 차단 시 해당 시나리오 폐기
    const scenarios = parsed.scenarios
      .map((s) => {
        const guarded = guardLlmOutput(s.text);
        guardViolations.push(...guarded.violations);
        return guarded.ok ? { angle: s.angle.slice(0, 40), text: guarded.text } : null;
      })
      .filter((s): s is Scenario => s !== null)
      .slice(0, 3);

    if (scenarios.length === 0) {
      await recordLlmCall('scenario', { ok: false, latencyMs: Date.now() - startedAt, guardViolations });
      return Response.json({ status: 'error', message: '필터를 통과한 문장이 없습니다. 다시 시도하세요.' } satisfies ScenarioLookup);
    }
    await recordLlmCall('scenario', { ok: true, latencyMs: Date.now() - startedAt, guardViolations });
    return Response.json({
      status: 'ok',
      scenarios,
      note: 'AI 생성 문구입니다 — 사실 여부를 확인하고 본인 말투로 다듬어 쓰세요.',
    } satisfies ScenarioLookup);
  } catch (e) {
    await recordLlmCall('scenario', { ok: false, latencyMs: Date.now() - startedAt, guardViolations });
    return Response.json(
      { status: 'error', message: e instanceof Error ? e.message : 'unknown' } satisfies ScenarioLookup,
      { status: 500 },
    );
  }
}
