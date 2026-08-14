/**
 * 사업장 파생값(경과·그룹) 계산 — 지도(/places), 대시보드 "오늘 가볼 곳", 메일 발송이 공유한다.
 * 화면과 발송이 같은 함수를 쓰는 것이 원칙 (2026-08-13 알림 지시).
 */
import { stageFor, type StageRule } from '@/config/elapsed-stages';
import type { Place } from '@/types';

export type MarkerGroup = 'switch' | 'priority' | 'anniversary' | 'other';

export const GROUPS: { key: MarkerGroup; label: string; color: string }[] = [
  { key: 'priority', label: '우선 접촉', color: '#3182F6' },
  { key: 'anniversary', label: 'N주년 도래', color: '#F59E0B' },
  { key: 'switch', label: '업종 전환 의심', color: '#EF4444' },
  { key: 'other', label: '그 외', color: '#94A3B8' },
];

export function elapsedMonthsOf(licenseDate: string, now = new Date()): number {
  const [y, m] = licenseDate.split('-').map(Number);
  return Math.max(0, (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m));
}

export function groupOf(place: Place, elapsed: number): MarkerGroup {
  if (place.suspectedRelicense) return 'switch';
  if (stageFor(elapsed).stage === 'priority') return 'priority';
  if (elapsed >= 11 && [11, 0, 1].includes(elapsed % 12)) return 'anniversary';
  return 'other';
}

export function anniversaryOf(elapsed: number): number {
  return Math.round(elapsed / 12);
}

export interface PlaceView {
  place: Place;
  elapsed: number;
  stage: StageRule;
  group: MarkerGroup;
}

export function toViews(places: Place[], now = new Date()): PlaceView[] {
  return places.map((p) => {
    const elapsed = elapsedMonthsOf(p.licenseDate, now);
    return { place: p, elapsed, stage: stageFor(elapsed), group: groupOf(p, elapsed) };
  });
}
