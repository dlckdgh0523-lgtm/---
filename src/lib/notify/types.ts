/**
 * 알림 채널 추상화 (2026-08-13).
 * 이메일이 주 채널. slack·kakao는 인터페이스만 — 구현하지 않은 것을 구현한 것처럼 쓰지 않는다.
 * 카카오를 택하지 않은 근거는 MEMORY.md: "나에게 보내기"만 검수 없이 가능, 타인 발송은
 * 비즈앱 전환+검수 필요, 자동 메시지는 반려 사유 → 실사용자 전달 채널이 아님.
 */
import type { TodayPick } from '@/lib/today-picks';

export interface NotifyPayload {
  regionCode: string;
  regionName: string;   // "서울특별시 용산구"
  picks: TodayPick[];   // ⚠️ 접점 정보만 — 개인 금액 데이터 절대 포함 금지
  summaryLine: string;  // 업종별 존속 위험 요약 한 줄
  mapUrl: string;       // 지도 화면 링크
  unsubscribeUrl: string;
  dateLabel: string;    // "8월 13일 (목)"
}

export type NotifyChannel = 'email' | 'slack' | 'kakao';

export interface SendResult {
  ok: boolean;
  message?: string;
}

export interface ChannelAdapter {
  send(payload: NotifyPayload, to: string): Promise<SendResult>;
}
