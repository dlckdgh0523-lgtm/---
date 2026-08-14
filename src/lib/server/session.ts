/**
 * 세션 — HMAC 서명 토큰을 httpOnly 쿠키로. 서버 전용.
 * SESSION_SECRET 미설정 시 개발용 기본값 사용 — 프로덕션에서는 반드시 설정 (README).
 */
import crypto from 'node:crypto';

export const SESSION_COOKIE = 'ifc_session';
const SECRET = process.env.SESSION_SECRET ?? 'dev-only-secret-do-not-use-in-prod';

function hmac(value: string): string {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

export function signSession(email: string): string {
  const body = Buffer.from(email.toLowerCase()).toString('base64url');
  return `${body}.${hmac(body)}`;
}

export function verifySession(token: string | undefined): string | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = hmac(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return Buffer.from(body, 'base64url').toString();
}

export function sessionCookie(token: string, maxAgeSec = 60 * 60 * 24 * 30): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
