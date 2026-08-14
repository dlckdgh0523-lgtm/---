/**
 * 롤플레잉 종료 후 채점.
 *
 * 역할 분담 (README 정직 기록):
 * - rubric(기준·가중치)은 코드 상수 (src/config/roleplay.ts) — LLM이 기준을 만들지 않는다.
 * - LLM은 고정된 기준별로 충족 여부 + 전사 인용 + 근거만 생성한다.
 * - 인용 검증(전사에 실제로 존재하는가, 저신뢰 발화가 아닌가)과 점수 합산은 코드가 한다.
 *
 * 인식 오류 오염 방지:
 * - confidence 임계 미달 발화는 "근거 사용 금지"로 표시해 전달하고, 코드가 인용 출처를 재검증.
 * - 세션 인식 실패율이 임계 이상이면 결과에 신뢰도 경고를 붙인다.
 */
import Anthropic from '@anthropic-ai/sdk';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/server/session';
import { checkRate } from '@/lib/llm/rate-limit';
import { recordLlmCall } from '@/lib/llm/metrics';
import { LLM_MODEL_ACCURATE, outputConfig } from '@/config/llm-model';
import { loadPlaceContext } from '@/lib/server/place-context';
import {
  DAILY_LIMITS,
  HINT_PENALTY,
  HINT_PENALTY_CAP,
  RECOGNITION_FAIL_WARN_RATE,
  RUBRIC,
} from '@/config/roleplay';

const SCORES_PER_DAY = DAILY_LIMITS.scores; // config 단일 출처

export interface TranscriptLine {
  speaker: 'user' | 'owner';
  text: string;
  lowConfidence?: boolean;
}

export interface CriterionVerdict {
  id: string;
  question: string;
  weight: number;
  met: boolean;
  quote: string | null;   // 전사 인용 (코드 검증 통과분만)
  reason: string;
  quoteValid: boolean;    // false = 인용 검증 실패 → 판정 불가 처리
}

export interface ScoreResult {
  status: 'ok' | 'disabled' | 'error';
  message?: string;
  score?: number;             // 0~100, 코드 합산
  verdicts?: CriterionVerdict[];
  hintCount?: number;
  hintPenalty?: number;
  recognitionFailRate?: number;
  lowReliability?: boolean;   // 인식 품질 경고
}

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    verdicts: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          id: { type: 'string' as const },
          met: { type: 'boolean' as const },
          quote: { type: 'string' as const, description: '판정 근거가 된 전사 문장을 그대로 인용. 근거가 없으면 빈 문자열' },
          reason: { type: 'string' as const, description: '판정 이유 1~2문장' },
        },
        required: ['id', 'met', 'quote', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
};

const norm = (s: string) => s.replace(/\s+/g, '');

async function judge(client: Anthropic, systemPrompt: string, userPrompt: string) {
  const response = await client.messages.create({
    model: LLM_MODEL_ACCURATE, // 판정 일관성 — opus
    max_tokens: 2048,
    output_config: outputConfig(LLM_MODEL_ACCURATE, { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } }),
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  if (response.stop_reason === 'refusal') throw new Error('judging refused');
  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('no output');
  return (JSON.parse(block.text) as { verdicts: { id: string; met: boolean; quote: string; reason: string }[] }).verdicts;
}

export async function POST(req: NextRequest) {
  const email = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!email) return Response.json({ status: 'error', message: '로그인이 필요합니다' } satisfies ScoreResult, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ status: 'disabled' } satisfies ScoreResult);
  if (!(await checkRate(`score:${email}`, SCORES_PER_DAY))) {
    return Response.json({ status: 'error', message: '오늘 채점 한도에 도달했습니다' } satisfies ScoreResult, { status: 429 });
  }

  try {
    const body = (await req.json()) as {
      region?: string;
      placeId?: string;
      transcript?: TranscriptLine[];
      hintCount?: number;
    };
    const { region, placeId, transcript = [], hintCount = 0 } = body;
    if (!region || !placeId || transcript.length === 0) {
      return Response.json({ status: 'error', message: 'bad params' } satisfies ScoreResult, { status: 400 });
    }
    const loaded = loadPlaceContext(region, placeId);
    if (!loaded) return Response.json({ status: 'error', message: '사업장을 찾을 수 없습니다' } satisfies ScoreResult, { status: 404 });

    const userLines = transcript.filter((l) => l.speaker === 'user');
    const lowCount = userLines.filter((l) => l.lowConfidence).length;
    const recognitionFailRate = userLines.length > 0 ? lowCount / userLines.length : 0;

    // 채점 근거로 쓸 수 있는 사용자 발화(정상 신뢰도)의 정규화 집합 — 인용 검증용
    const usableUserTexts = userLines.filter((l) => !l.lowConfidence).map((l) => norm(l.text));
    const allTexts = transcript.map((l) => norm(l.text));

    const transcriptText = transcript
      .map((l) => `${l.speaker === 'user' ? '설계사' : '사장님'}${l.lowConfidence ? ' (⚠️인식 신뢰도 낮음 — 채점 근거 사용 금지)' : ''}: ${l.text}`)
      .join('\n');

    const systemPrompt = `너는 보험설계사 방문 상담 롤플레잉의 채점자다.
아래 고정된 기준 각각에 대해 충족 여부를 판정한다. 기준을 새로 만들거나 바꾸지 않는다.
규칙:
- 판정 근거(quote)는 반드시 전사에서 실제 문장을 그대로 인용한다. 인용 없는 판정은 무효 처리된다.
- "⚠️인식 신뢰도 낮음" 표시가 붙은 발화는 어떤 판정의 근거로도 인용하지 않는다.
- 점수는 계산하지 않는다 — 충족 여부와 근거만.`;

    const userPrompt = `[기준]\n${RUBRIC.map((r) => `- id=${r.id}: ${r.question}`).join('\n')}\n\n[전사]\n${transcriptText}`;

    const startedAt = Date.now();
    let retryCount = 0;
    const client = new Anthropic();
    let raw = await judge(client, systemPrompt, userPrompt);

    // 코드 검증: 인용이 전사에 실제 존재 + 저신뢰 발화가 아님. 실패 시 1회 재시도.
    const validate = (vs: typeof raw) =>
      RUBRIC.map((r) => {
        const v = vs.find((x) => x.id === r.id);
        if (!v) return { ...r, question: r.question, met: false, quote: null, reason: '판정 누락', quoteValid: false };
        const q = norm(v.quote ?? '');
        const inTranscript = q.length > 0 && allTexts.some((t) => t.includes(q));
        const fromLowConf = q.length > 0 && !usableUserTexts.some((t) => t.includes(q)) && !transcript.filter((l) => l.speaker === 'owner').map((l) => norm(l.text)).some((t) => t.includes(q));
        const quoteValid = v.met ? inTranscript && !fromLowConf : true; // 미충족 판정은 인용 없어도 유효
        return {
          id: r.id,
          question: r.question,
          weight: r.weight,
          met: quoteValid ? v.met : false,
          quote: inTranscript ? v.quote : null,
          reason: quoteValid ? v.reason : `${v.reason} (인용 검증 실패 — 충족으로 인정하지 않음)`,
          quoteValid,
        } satisfies CriterionVerdict;
      });

    let verdicts = validate(raw);
    if (verdicts.some((v) => !v.quoteValid)) {
      // 1회 재시도 — 인용 규칙 재강조
      retryCount = 1;
      try {
        raw = await judge(client, systemPrompt, `${userPrompt}\n\n[재시도] 이전 판정 중 인용이 전사에 없거나 저신뢰 발화였다. quote는 전사 문장을 글자 그대로 복사하라.`);
        verdicts = validate(raw);
      } catch {
        /* 재시도 실패 시 1차 결과 유지 */
      }
    }

    // 점수 합산은 코드가 한다
    const base = verdicts.reduce((s, v) => s + (v.met ? v.weight : 0), 0);
    const hintPenalty = Math.min(hintCount * HINT_PENALTY, HINT_PENALTY_CAP);
    const score = Math.max(0, base - hintPenalty);

    await recordLlmCall('roleplay-score', { ok: true, latencyMs: Date.now() - startedAt, retries: retryCount });
    return Response.json({
      status: 'ok',
      score,
      verdicts,
      hintCount,
      hintPenalty,
      recognitionFailRate: Math.round(recognitionFailRate * 100) / 100,
      lowReliability: recognitionFailRate >= RECOGNITION_FAIL_WARN_RATE,
    } satisfies ScoreResult);
  } catch (e) {
    await recordLlmCall('roleplay-score', { ok: false, latencyMs: 0 });
    return Response.json({ status: 'error', message: e instanceof Error ? e.message : 'unknown' } satisfies ScoreResult, { status: 500 });
  }
}
