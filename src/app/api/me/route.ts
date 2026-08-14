/**
 * 내 계정 — GET: 세션 확인 + 프로필 조회 / PUT: 프로필·수신 동의 저장.
 * 프로필(보유현금 포함)이 서버에 저장된다 — 2026-08-13 판단 변경 (MEMORY.md). 계약은 여전히 로컬 전용.
 */
import { NextRequest } from 'next/server';
import { findUser, updateUser } from '@/lib/server/users';
import { SESSION_COOKIE, verifySession } from '@/lib/server/session';
import type { AgentProfile } from '@/types';

function authedEmail(req: NextRequest): string | null {
  return verifySession(req.cookies.get(SESSION_COOKIE)?.value);
}

export async function GET(req: NextRequest) {
  const email = authedEmail(req);
  if (!email) return Response.json({ ok: false }, { status: 401 });
  const user = await findUser(email);
  if (!user) return Response.json({ ok: false }, { status: 401 });
  return Response.json({ ok: true, email: user.email, emailOptIn: user.emailOptIn, profile: user.profile });
}

export async function PUT(req: NextRequest) {
  const email = authedEmail(req);
  if (!email) return Response.json({ ok: false }, { status: 401 });
  try {
    const { profile, emailOptIn } = (await req.json()) as { profile?: AgentProfile; emailOptIn?: boolean };
    const user = await updateUser(email, { profile, emailOptIn });
    if (!user) return Response.json({ ok: false }, { status: 401 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, message: 'bad request' }, { status: 400 });
  }
}
