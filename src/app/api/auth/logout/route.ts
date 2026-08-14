/** 로그아웃 — 세션 쿠키 제거. */
import { clearSessionCookie } from '@/lib/server/session';

export async function POST() {
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie() } });
}
