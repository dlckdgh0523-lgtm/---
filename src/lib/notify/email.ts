/**
 * 이메일 어댑터 — Resend (https://resend.com). SDK 없이 REST 호출 (의존성 최소화).
 *
 * ⚠️ 도메인 인증 전 제약 (Resend 정책, README에도 명시):
 * - 발신 주소는 onboarding@resend.dev만 가능
 * - 수신은 Resend 계정 소유자 본인 이메일로만 가능
 * 도메인 인증 후에는 NOTIFY_EMAIL_FROM 환경변수만 교체하면 된다 (코드 수정 불필요).
 *
 * 키: RESEND_API_KEY (.env.local, 서버 전용 — 클라이언트 노출 금지)
 */
import { renderHtml, renderSubject, renderText } from './render';
import type { ChannelAdapter, NotifyPayload, SendResult } from './types';

/** From 헤더 정규화 — 이메일만이면 표시 이름을 붙이고, 이미 "이름 <메일>" 형태면 그대로 쓴다. */
export function fromHeader(raw: string | undefined): string {
  if (!raw) return '인톡 사전과제 <onboarding@resend.dev>';
  return raw.includes('<') ? raw : `인톡 사전과제 <${raw}>`;
}

export const emailAdapter: ChannelAdapter = {
  async send(payload: NotifyPayload, to: string): Promise<SendResult> {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { ok: false, message: 'RESEND_API_KEY 미설정 — 발송 보류' };
    // NOTIFY_EMAIL_FROM은 이메일만("no-reply@x.com") 또는 이름 포함("이름 <no-reply@x.com>") 둘 다 허용.
    // 이미 <>가 있으면 그대로 쓰고(이중 래핑 방지), 이메일만이면 표시 이름을 붙인다.
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
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, message: `Resend ${res.status}: ${body.slice(0, 200)}` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'unknown' };
    }
  },
};
