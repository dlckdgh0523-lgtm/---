/**
 * 회원가입 — 이메일 + authProof(클라이언트 PBKDF2 파생 해시).
 * ⚠️ 서버는 원문 비밀번호를 절대 받지 않는다 — 받는 것은 인증용 파생 해시뿐이며,
 *    금고 키 파생용 원문은 클라이언트를 벗어나지 않는다 (README §로그인/금고).
 * 수신 동의는 계정과 분리된 구독 시스템으로 이동 (2026-08-14) — 여기서 받지 않는다.
 * 성공 시 JWT 쿠키 발급.
 */
import { NextRequest } from 'next/server';
import { createUser, isValidAuthProof } from '@/lib/server/users';
import { sessionCookie, signSession } from '@/lib/server/session';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const { email, authProof } = (await req.json()) as { email?: string; authProof?: string };
    if (!email || !EMAIL_RE.test(email)) return Response.json({ ok: false, message: '이메일 형식을 확인하세요.' }, { status: 400 });
    if (!isValidAuthProof(authProof)) return Response.json({ ok: false, message: '잘못된 인증 형식입니다.' }, { status: 400 });
    let user;
    try {
      user = await createUser(email, authProof);
    } catch {
      // 서버리스에서 저장 백엔드(Redis) 미설정 시 파일 쓰기가 실패한다 — 원인을 숨기지 않는다
      return Response.json({ ok: false, message: '서버 저장소가 준비되지 않았습니다. 관리자에게 문의하세요.' }, { status: 503 });
    }
    if (!user) return Response.json({ ok: false, message: '이미 가입된 이메일입니다.' }, { status: 409 });
    return Response.json(
      { ok: true, email: user.email },
      { headers: { 'Set-Cookie': sessionCookie(signSession(user.email)) } },
    );
  } catch {
    return Response.json({ ok: false, message: 'bad request' }, { status: 400 });
  }
}
