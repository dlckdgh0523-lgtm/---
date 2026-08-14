/**
 * 구독 등록 — 로그인 여부와 무관, 이메일+지역만으로 등록 (2026-08-14 지시).
 * 계정과 구독은 시스템적으로 묶지 않는다. GET ?email=로 구독 상태 조회.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { isSubscribed, subscribe } from '@/lib/server/subscribers';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 서버에서 지역 팩 존재 확인 — 팩 없는 지역 구독은 발송할 내용이 없다 */
function packExists(region: string): boolean {
  if (!/^\d{5}$/.test(region)) return false;
  return fs.existsSync(path.join(process.cwd(), 'public', 'data', 'regions', region, 'places.json'));
}

export async function POST(req: NextRequest) {
  try {
    const { email, region } = (await req.json()) as { email?: string; region?: string };
    if (!email || !EMAIL_RE.test(email)) return Response.json({ ok: false, message: '이메일 형식을 확인하세요.' }, { status: 400 });
    if (!region) return Response.json({ ok: false, message: '지역을 선택하세요.' }, { status: 400 });
    if (!packExists(region)) {
      return Response.json({ ok: false, message: '해당 지역은 아직 데이터 팩이 없어 발송할 내용이 없습니다.' }, { status: 400 });
    }
    await subscribe(email, region);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, message: '등록 실패 — 잠시 후 다시 시도하세요.' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email') ?? '';
  if (!email) return Response.json({ subscribed: false });
  const sub = await isSubscribed(email);
  return Response.json({ subscribed: Boolean(sub), region: sub?.region ?? null });
}
