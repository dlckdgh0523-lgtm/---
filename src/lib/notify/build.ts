/** 서버 전용 — 지역 팩을 읽어 발송 페이로드를 만든다. 화면과 동일한 pickTodayContacts 사용. */
import fs from 'node:fs';
import path from 'node:path';
import { regionLabel } from '@/data/regions';
import { industrySummaryLine, pickTodayContacts } from '@/lib/today-picks';
import type { NotifyPayload } from './types';
import type { Place } from '@/types';

export function buildPayload(regionCode: string, email: string, now = new Date()): NotifyPayload | null {
  const packPath = path.join(process.cwd(), 'public', 'data', 'regions', regionCode, 'places.json');
  if (!fs.existsSync(packPath)) return null; // 팩 없는 지역 — 발송 스킵
  const places = JSON.parse(fs.readFileSync(packPath, 'utf-8')) as Place[];
  const picks = pickTodayContacts(places, now, 5);
  if (picks.length === 0) return null;
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return {
    regionCode,
    regionName: regionLabel(regionCode),
    picks,
    summaryLine: industrySummaryLine(),
    mapUrl: `${base}/places`,
    unsubscribeUrl: `${base}/api/notify/unsubscribe?email=${encodeURIComponent(email)}`,
    dateLabel: `${now.getMonth() + 1}월 ${now.getDate()}일 (${'일월화수목금토'[now.getDay()]})`,
  };
}
