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
    let user;
    try {
      user = await createUser(email, password, !!emailOptIn);
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
