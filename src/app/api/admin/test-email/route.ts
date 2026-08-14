/**
 * 관리자용 테스트 발송 — 배포 환경에서 실발송 1건을 수동 트리거한다 (2026-08-14 검증 지시).
 * ADMIN_EMAILS 화이트리스트의 JWT만. 크론(CRON_SECRET)과 별개 경로 — 발송 로직·본문은 실제와 동일.
 * 응답에 Resend 메시지 id를 담아 Logs에서 delivered 상태를 대조할 수 있게 한다.
 */
import { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/server/session';
import { isAdminEmail } from '@/lib/server/admin';
import { buildPayload } from '@/lib/notify/build';
import { fromHeader } from '@/lib/notify/email';
import { renderHtml, renderSubject, renderText } from '@/lib/notify/render';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const email = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!isAdminEmail(email)) return new Response('Not Found', { status: 404 });

  const key = process.env.RESEND_API_KEY;
  if (!key) return Response.json({ ok: false, message: 'RESEND_API_KEY 미설정' }, { status: 400 });

  const { to, region = '11170' } = (await req.json().catch(() => ({}))) as { to?: string; region?: string };
  if (!to || !EMAIL_RE.test(to)) return Response.json({ ok: false, message: 'bad to' }, { status: 400 });

  const payload = buildPayload(region, to);
  if (!payload) return Response.json({ ok: false, message: '지역 팩 없음 또는 오늘 접점 0건' }, { status: 400 });

  const from = fromHeader(process.env.NOTIFY_EMAIL_FROM);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: renderSubject(payload),
        html: renderHtml(payload),
        text: renderText(payload),
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await res.json().catch(() => ({}));
    // 본문에 금액 데이터가 없음을 서버가 재확인 (money 패턴)
    const rendered = renderHtml(payload) + renderText(payload);
    const containsMoney = /만원|보유\s?현금|수령액|선지급액|환수\s?\d/.test(rendered);
    return Response.json({
      ok: res.ok,
      status: res.status,
      resendId: (body as { id?: string }).id ?? null,
      from,
      to,
      unsubscribeUrl: payload.unsubscribeUrl,
      mapUrl: payload.mapUrl,
      picksCount: payload.picks.length,
      bodyContainsMoney: containsMoney,
      resendError: res.ok ? null : body,
    });
  } catch (e) {
    return Response.json({ ok: false, message: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}

/** 발송 상태 조회 — Resend GET /emails/{id}로 delivered 대조 */
export async function GET(req: NextRequest) {
  const email = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!isAdminEmail(email)) return new Response('Not Found', { status: 404 });
  const key = process.env.RESEND_API_KEY;
  const id = req.nextUrl.searchParams.get('id');
  if (!key || !id) return Response.json({ ok: false, message: 'need key+id' }, { status: 400 });
  try {
    const res = await fetch(`https://api.resend.com/emails/${id}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
    });
    const body = await res.json();
    return Response.json({ ok: res.ok, last_event: (body as { last_event?: string }).last_event ?? null, detail: body });
  } catch (e) {
    return Response.json({ ok: false, message: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
}
