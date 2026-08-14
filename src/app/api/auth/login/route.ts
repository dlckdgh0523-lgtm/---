/**
 * 로그인 — 이메일 + authProof(클라이언트 PBKDF2 파생 해시). 성공 시 JWT 쿠키 발급.
 * ⚠️ 서버는 원문 비밀번호를 절대 받지 않는다. 금고 잠금 해제 시에도 이 라우트가
 *    재사용된다 (비밀번호 검증의 단일 출처 — 클라이언트는 검증 성공 후에만 금고 키를 파생).
 */
import { NextRequest } from 'next/server';
import { isValidAuthProof, verifyAuthProof } from '@/lib/server/users';
import { sessionCookie, signSession } from '@/lib/server/session';

export async function POST(req: NextRequest) {
  try {
    const { email, authProof } = (await req.json()) as { email?: string; authProof?: string };
    const user = email && isValidAuthProof(authProof) ? await verifyAuthProof(email, authProof) : null;
    if (!user) return Response.json({ ok: false, message: '이메일 또는 비밀번호가 맞지 않습니다.' }, { status: 401 });
    return Response.json(
      { ok: true, email: user.email },
      { headers: { 'Set-Cookie': sessionCookie(signSession(user.email)) } },
    );
  } catch {
    return Response.json({ ok: false, message: 'bad request' }, { status: 400 });
  }
}
