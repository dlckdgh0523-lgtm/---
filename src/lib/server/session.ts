/**
 * 세션 — JWT(HS256)를 httpOnly 쿠키로. 서버 전용.
 * - 만료: 7일 (JWT_TTL_SEC). API 라우트는 verifySession으로 인증 여부만 확인한다.
 * - SESSION_SECRET 미설정 시 개발용 기본값 — 프로덕션에서는 반드시 설정 (README).
 */
import crypto from 'node:crypto';

export const SESSION_COOKIE = 'ifc_session';
export const JWT_TTL_SEC = 60 * 60 * 24 * 7; // 7일
const SECRET = process.env.SESSION_SECRET ?? 'dev-only-secret-do-not-use-in-prod';

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

function hmac(value: string): string {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}

/** JWT 발급 — payload는 {sub: email, iat, exp}뿐. 개인정보 추가 금지. */
export function signSession(email: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub: email.toLowerCase(), iat: now, exp: now + JWT_TTL_SEC }));
  return `${header}.${payload}.${hmac(`${header}.${payload}`)}`;
}

/** 서명·만료 검증 후 이메일(sub) 반환. 실패 시 null. */
export function verifySession(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = hmac(`${header}.${payload}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sub?: string; exp?: number };
    if (!claims.sub || !claims.exp) return null;
    if (Math.floor(Date.now() / 1000) >= claims.exp) return null; // 만료
    return claims.sub;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, maxAgeSec = JWT_TTL_SEC): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
