/** 로그인 — 이메일 + 비밀번호. */
import { NextRequest } from 'next/server';
import { verifyPassword } from '@/lib/server/users';
import { sessionCookie, signSession } from '@/lib/server/session';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = (await req.json()) as { email?: string; password?: string };
    const user = email && password ? await verifyPassword(email, password) : null;
    if (!user) return Response.json({ ok: false, message: '이메일 또는 비밀번호가 맞지 않습니다.' }, { status: 401 });
    return Response.json(
      { ok: true, email: user.email },
      { headers: { 'Set-Cookie': sessionCookie(signSession(user.email)) } },
    );
  } catch {
    return Response.json({ ok: false, message: 'bad request' }, { status: 400 });
  }
}
