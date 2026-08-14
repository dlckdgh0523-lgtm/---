/** 메일 하단 수신 해제 링크 — 사용자 테이블의 수신 동의를 끈다 (계정은 유지). */
import { NextRequest } from 'next/server';
import { findUser, updateUser } from '@/lib/server/users';

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email') ?? '';
  const user = email ? await findUser(email) : null;
  if (user) await updateUser(user.email, { emailOptIn: false });
  const html = `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:48px;text-align:center;color:#191F28;">
  <h2>${user ? '수신이 해제되었습니다' : '등록되지 않은 주소입니다'}</h2>
  <p style="color:#4E5968;">다시 받으려면 앱의 설정 화면에서 수신 동의를 켜세요.</p></body>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
