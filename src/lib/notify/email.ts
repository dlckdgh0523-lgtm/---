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

export const emailAdapter: ChannelAdapter = {
  async send(payload: NotifyPayload, to: string): Promise<SendResult> {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { ok: false, message: 'RESEND_API_KEY 미설정 — 발송 보류' };
    const from = process.env.NOTIFY_EMAIL_FROM ?? 'onboarding@resend.dev'; // 도메인 인증 후 교체 지점
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `인톡 사전과제 <${from}>`,
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
