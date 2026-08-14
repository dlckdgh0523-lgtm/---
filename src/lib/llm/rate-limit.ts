/**
 * LLM 자원 통제 — 세션(이메일) 기준 레이트 리밋. 전 LLM 라우트 공용 모듈.
 * 인메모리라 서버리스에서는 인스턴스별로 동작 (데모 수준 — README 한계 명시).
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

/** @returns true = 허용, false = 한도 초과 */
export function checkRate(key: string, limit: number, windowMs = 24 * 60 * 60 * 1000): boolean {
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
