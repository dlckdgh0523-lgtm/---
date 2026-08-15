/**
 * LLM 보조 심사 — 규칙으로 못 잡는 성질(각도의 다양성, 자연스러움)만.
 * 심사자 프롬프트는 고정한다. 심사 자체가 비결정적이므로 러너가 3회 반복해 변동성을 함께 본다.
 * ⚠️ 심사도 LLM이라 흔들린다 — 이 결과를 규칙 판정과 동급으로 신뢰하지 않는다(보조).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AssertResult } from './assert';
import { LLM_MODEL_BALANCED, outputConfig } from '../src/config/llm-model';

const JUDGE_SYSTEM =
  '너는 보험설계사 첫 접근 문장 3개를 심사한다. 세 문장이 서로 "다른 각도"(예: 주년 축하 / 업종 공감 / 동네 이웃)인지만 판단한다. ' +
  '판단 근거를 재무·법령으로 확장하지 말고, 오직 각도의 다양성만 본다. JSON {distinct: boolean, reason: string}으로 답한다.';

const SCHEMA = {
  type: 'object' as const,
  properties: { distinct: { type: 'boolean' as const }, reason: { type: 'string' as const } },
  required: ['distinct', 'reason'],
  additionalProperties: false,
};

const PERSONA_JUDGE_SYSTEM =
  '너는 롤플레잉에서 "사장님" 역할의 대사 하나가 실제 가게 사장님처럼 자연스러운지만 판단한다. ' +
  '내용의 옳고 그름이 아니라 말투가 어색하지 않은지(기계적·설명조·부자연스러운 존댓말이 아닌지)만 본다. ' +
  'JSON {natural: boolean, reason: string}으로 답한다.';
const PERSONA_SCHEMA = {
  type: 'object' as const,
  properties: { natural: { type: 'boolean' as const }, reason: { type: 'string' as const } },
  required: ['natural', 'reason'],
  additionalProperties: false,
};

/** 페르소나 대사 자연스러움 — 보조 심사(규칙이 우선). 심사자도 흔들리므로 러너가 3회 반복해 변동성을 본다. */
export async function judgePersonaNatural(reply: string): Promise<AssertResult> {
  if (!process.env.ANTHROPIC_API_KEY || !reply.trim()) return { name: 'judge:persona-natural', pass: true, detail: 'skipped' };
  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: LLM_MODEL_BALANCED,
      max_tokens: 300,
      output_config: outputConfig(LLM_MODEL_BALANCED, { effort: 'low', format: { type: 'json_schema', schema: PERSONA_SCHEMA } }),
      system: PERSONA_JUDGE_SYSTEM,
      messages: [{ role: 'user', content: reply }],
    });
    const block = res.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return { name: 'judge:persona-natural', pass: false, detail: '심사 파싱 실패' };
    const j = JSON.parse(block.text) as { natural: boolean; reason: string };
    return { name: 'judge:persona-natural', pass: j.natural, detail: j.natural ? undefined : j.reason.slice(0, 60) };
  } catch (e) {
    return { name: 'judge:persona-natural', pass: true, detail: `심사 오류 무시: ${e instanceof Error ? e.message : 'unknown'}` };
  }
}

export async function judgeScenarioAngles(texts: string[]): Promise<AssertResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { name: 'judge:distinct-angles', pass: true, detail: 'skipped(키 없음)' };
  try {
    const client = new Anthropic();
    const res = await client.messages.create({
      model: LLM_MODEL_BALANCED, // 심사자는 흔들리면 안 됨 — sonnet 이상 고정
      max_tokens: 512,
      output_config: outputConfig(LLM_MODEL_BALANCED, { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } }),
      system: JUDGE_SYSTEM,
      messages: [{ role: 'user', content: texts.map((t, i) => `${i + 1}. ${t}`).join('\n') }],
    });
    const block = res.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return { name: 'judge:distinct-angles', pass: false, detail: '심사 파싱 실패' };
    const j = JSON.parse(block.text) as { distinct: boolean; reason: string };
    return { name: 'judge:distinct-angles', pass: j.distinct, detail: j.distinct ? undefined : j.reason.slice(0, 60) };
  } catch (e) {
    return { name: 'judge:distinct-angles', pass: true, detail: `심사 오류 무시: ${e instanceof Error ? e.message : 'unknown'}` };
  }
}
