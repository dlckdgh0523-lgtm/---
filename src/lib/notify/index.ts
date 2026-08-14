/**
 * 채널 디스패처 — send(payload, to, channel).
 * email만 구현. slack·kakao는 인터페이스만 남긴다 (미구현을 구현처럼 쓰지 않는다).
 */
import { emailAdapter } from './email';
import type { ChannelAdapter, NotifyChannel, NotifyPayload, SendResult } from './types';

const notImplemented = (name: string): ChannelAdapter => ({
  async send(): Promise<SendResult> {
    return { ok: false, message: `${name} 어댑터는 인터페이스만 존재 — 미구현` };
  },
});

const ADAPTERS: Record<NotifyChannel, ChannelAdapter> = {
  email: emailAdapter,
  // slack: 웹훅 URL만 있으면 어댑터 구현으로 연결 가능 — 미구현
  slack: notImplemented('slack'),
  // kakao: 알림톡은 사업자 계약 필요(개인 개발자 불가). 채널 운영 조직이면 어댑터 추가만으로 연결 — 미구현
  kakao: notImplemented('kakao'),
};

export function send(payload: NotifyPayload, to: string, channel: NotifyChannel = 'email'): Promise<SendResult> {
  return ADAPTERS[channel].send(payload, to);
}
