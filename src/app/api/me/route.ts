/**
 * 내 계정 — GET: JWT 확인 + 프로필 조회 / PUT: 프로필 저장.
 * 프로필(보유현금 포함)이 서버에 저장된다 — 2026-08-13 판단 변경 (MEMORY.md). 계약은 로컬 금고 전용.
 * 수신 동의는 계정과 분리된 구독 시스템으로 이동 (2026-08-14) — 이 라우트에서 다루지 않는다.
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
  return Response.json({ ok: true, email: user.email, profile: user.profile });
}

export async function PUT(req: NextRequest) {
  const email = authedEmail(req);
  if (!email) return Response.json({ ok: false }, { status: 401 });
  try {
    const { profile } = (await req.json()) as { profile?: AgentProfile };
    const user = await updateUser(email, { profile });
    if (!user) return Response.json({ ok: false }, { status: 401 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, message: 'bad request' }, { status: 400 });
  }
}
