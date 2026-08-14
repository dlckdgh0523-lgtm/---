/**
 * 일일 발송 — Vercel Cron이 매일 오전 10시(KST, vercel.json의 "0 1 * * *" UTC)에 호출.
 * 옵트인한 구독자만 발송. ?dry=1이면 발송 없이 페이로드만 만들어 반환 (키 없이 테스트).
 * CRON_SECRET이 설정돼 있으면 Authorization: Bearer 헤더를 검증한다.
 */
import { NextRequest } from 'next/server';
import { send } from '@/lib/notify';
import { buildPayload } from '@/lib/notify/build';
import { listSubscribers } from '@/lib/server/subscribers';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  }
  const dry = req.nextUrl.searchParams.get('dry') === '1';
  const subscribers = await listSubscribers(); // 계정과 분리된 구독 저장소 (2026-08-14)
  const results: { email: string; region: string; ok: boolean; message?: string }[] = [];
  for (const sub of subscribers) {
    const payload = buildPayload(sub.region, sub.email);
    if (!payload) {
      results.push({ email: sub.email, region: sub.region, ok: false, message: '지역 팩 없음 — 스킵' });
      continue;
    }
    if (dry) {
      results.push({ email: sub.email, region: sub.region, ok: true, message: `dry: ${payload.picks.length}건 선정` });
      continue;
    }
    const r = await send(payload, sub.email, 'email');
    results.push({ email: sub.email, region: sub.region, ...r });
  }
  return Response.json({ ok: true, total: subscribers.length, results });
}
