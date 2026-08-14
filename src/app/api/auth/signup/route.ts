/** 회원가입 — 이메일 + 비밀번호 + 메일 수신 동의(기본 false). 성공 시 즉시 로그인 쿠키 발급. */
import { NextRequest } from 'next/server';
import { createUser } from '@/lib/server/users';
import { sessionCookie, signSession } from '@/lib/server/session';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const { email, password, emailOptIn } = (await req.json()) as {
      email?: string;
      password?: string;
      emailOptIn?: boolean;
    };
    if (!email || !EMAIL_RE.test(email)) return Response.json({ ok: false, message: '이메일 형식을 확인하세요.' }, { status: 400 });
    if (!password || password.length < 6) return Response.json({ ok: false, message: '비밀번호는 6자 이상이어야 합니다.' }, { status: 400 });
    const user = createUser(email, password, !!emailOptIn);
    if (!user) return Response.json({ ok: false, message: '이미 가입된 이메일입니다.' }, { status: 409 });
    return Response.json(
      { ok: true, email: user.email },
      { headers: { 'Set-Cookie': sessionCookie(signSession(user.email)) } },
    );
  } catch {
    return Response.json({ ok: false, message: 'bad request' }, { status: 400 });
  }
}
