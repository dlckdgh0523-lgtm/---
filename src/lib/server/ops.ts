/**
 * 운영 기록 — 최근 발송 이력 등 (관리자 화면용).
 * 수신자 주소는 저장하지 않는다 — 건수와 결과만.
 */
import fs from 'node:fs';
import path from 'node:path';
import { redisAvailable, redisCommand } from '@/lib/server/redis';

export interface NotifyRunRecord {
  at: string;
  total: number;
  okCount: number;
  dry: boolean;
}

const FILE = path.join(process.cwd(), 'data', 'notify-lastrun.json');
const REDIS_KEY = 'ifc:notify:lastRun';

export async function saveNotifyRun(record: NotifyRunRecord): Promise<void> {
  try {
    if (redisAvailable()) {
      await redisCommand(['SET', REDIS_KEY, JSON.stringify(record)]);
      return;
    }
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(record, null, 2));
  } catch {
    /* 기록 실패가 발송을 막지 않는다 */
  }
}

export async function readNotifyRun(): Promise<NotifyRunRecord | null> {
  try {
    if (redisAvailable()) {
      const raw = (await redisCommand(['GET', REDIS_KEY])) as string | null;
      return raw ? (JSON.parse(raw) as NotifyRunRecord) : null;
    }
    return JSON.parse(fs.readFileSync(FILE, 'utf-8')) as NotifyRunRecord;
  } catch {
    return null;
  }
}
