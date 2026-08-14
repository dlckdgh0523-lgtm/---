/**
 * LLM 운영 메트릭 (MLOps) — 기능별 호출 성공/실패, 가드 차단 사유, 재시도, 지연.
 * 저장: Redis HINCRBY (있으면) / 인메모리 (로컬 폴백 — 서버 재시작 시 소실, 데모 수준).
 * 개인 식별값은 기록하지 않는다 — 카운터와 지연 합계뿐.
 */
import { redisAvailable, redisCommand } from '@/lib/server/redis';

export type LlmFeature = 'scenario' | 'roleplay-turn' | 'roleplay-score' | 'hint';

// globalThis에 부착 — Next dev는 라우트별로 모듈을 따로 번들하므로 모듈 스코프 Map은 라우트 간 분리된다
const memory: Map<string, Record<string, number>> = ((globalThis as Record<string, unknown>).__ifcMetrics ??=
  new Map<string, Record<string, number>>()) as Map<string, Record<string, number>>;

function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function metricsKey(feature: LlmFeature, date = new Date()): string {
  return `ifc:metrics:${dayKey(date)}:${feature}`;
}

async function incr(key: string, field: string, by = 1): Promise<void> {
  if (redisAvailable()) {
    try {
      await redisCommand(['HINCRBY', key, field, by]);
      await redisCommand(['EXPIRE', key, 60 * 60 * 24 * 14]); // 14일 보존
      return;
    } catch {
      /* 메트릭 장애가 기능을 막지 않는다 */
    }
  }
  const bucket = memory.get(key) ?? {};
  bucket[field] = (bucket[field] ?? 0) + by;
  memory.set(key, bucket);
}

/** 호출 1건 기록 — 라우트 핸들러 종료 시점에 호출 */
export async function recordLlmCall(
  feature: LlmFeature,
  result: { ok: boolean; latencyMs: number; guardViolations?: string[]; retries?: number },
): Promise<void> {
  const key = metricsKey(feature);
  await incr(key, result.ok ? 'ok' : 'fail');
  await incr(key, 'latencySumMs', Math.round(result.latencyMs));
  await incr(key, 'latencyCount');
  if (result.retries) await incr(key, 'retries', result.retries);
  for (const v of result.guardViolations ?? []) {
    await incr(key, `guard:${v}`);
  }
}

export interface FeatureMetrics {
  ok: number;
  fail: number;
  retries: number;
  avgLatencyMs: number | null;
  guardBlocks: Record<string, number>; // 사유별
}

/** 특정 일자의 기능별 메트릭 읽기 (관리자 화면용) */
export async function readLlmMetrics(date = new Date()): Promise<Record<LlmFeature, FeatureMetrics>> {
  const features: LlmFeature[] = ['scenario', 'roleplay-turn', 'roleplay-score', 'hint'];
  const out = {} as Record<LlmFeature, FeatureMetrics>;
  for (const feature of features) {
    const key = metricsKey(feature, date);
    let raw: Record<string, number> = {};
    if (redisAvailable()) {
      try {
        const flat = (await redisCommand(['HGETALL', key])) as string[] | null;
        if (Array.isArray(flat)) {
          for (let i = 0; i < flat.length; i += 2) raw[flat[i]] = Number(flat[i + 1]);
        }
      } catch {
        raw = {};
      }
    } else {
      raw = memory.get(key) ?? {};
    }
    const guardBlocks: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k.startsWith('guard:')) guardBlocks[k.slice(6)] = v;
    }
    out[feature] = {
      ok: raw.ok ?? 0,
      fail: raw.fail ?? 0,
      retries: raw.retries ?? 0,
      avgLatencyMs: raw.latencyCount ? Math.round((raw.latencySumMs ?? 0) / raw.latencyCount) : null,
      guardBlocks,
    };
  }
  return out;
}
