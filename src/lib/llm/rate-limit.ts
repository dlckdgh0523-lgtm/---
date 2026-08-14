/**
 * LLM 자원 통제 — 로그인 세션(JWT의 이메일) 기준 레이트 리밋. 전 LLM 라우트 공용.
 * Redis(있으면): INCR + EXPIRE — 서버리스 인스턴스 간 공유되는 유일한 카운터 (2026-08-14).
 * 인메모리(로컬 폴백): 개발 환경 전용.
 */
import { redisAvailable, redisCommand } from '@/lib/server/redis';

// globalThis 부착 — Next dev의 라우트별 모듈 분리로 카운터가 흩어지는 것 방지 (인메모리 폴백 한정)
const buckets: Map<string, { count: number; resetAt: number }> = ((globalThis as Record<string, unknown>).__ifcRateBuckets ??=
  new Map<string, { count: number; resetAt: number }>()) as Map<string, { count: number; resetAt: number }>;

/** @returns true = 허용, false = 한도 초과 */
export async function checkRate(key: string, limit: number, windowMs = 24 * 60 * 60 * 1000): Promise<boolean> {
  if (redisAvailable()) {
    try {
      const redisKey = `ifc:rate:${key}`;
      const count = (await redisCommand(['INCR', redisKey])) as number;
      if (count === 1) await redisCommand(['EXPIRE', redisKey, Math.ceil(windowMs / 1000)]);
      return count <= limit;
    } catch {
      return true; // 카운터 장애가 기능 전체를 막지 않게 — 데모 우선 (README 한계 기록)
    }
  }
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || now > entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}
