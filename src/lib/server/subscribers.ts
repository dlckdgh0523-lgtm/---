/**
 * 이메일 구독(오늘의 접점 알림) — 계정과 분리된 저장소 (2026-08-14 지시).
 * - 로그인 여부와 무관하게 이메일+지역만으로 등록한다.
 * - 로그인 계정과 구독 이메일이 같아도 시스템적으로 묶지 않는다.
 * - 수신 해제는 이메일 파라미터 방식 그대로 (기존 방식 유지).
 * 저장: Redis(있으면) / data/subscribers.json(로컬 폴백).
 */
import fs from 'node:fs';
import path from 'node:path';
import { redisAvailable, redisCommand } from '@/lib/server/redis';

export interface Subscriber {
  email: string;
  region: string; // 시군구코드 — 발송 콘텐츠 선택에 필요
  createdAt: string;
}

const FILE = path.join(process.cwd(), 'data', 'subscribers.json');
const REDIS_KEY = 'ifc:subscribers';

async function load(): Promise<Subscriber[]> {
  if (redisAvailable()) {
    const raw = (await redisCommand(['GET', REDIS_KEY])) as string | null;
    return raw ? (JSON.parse(raw) as Subscriber[]) : [];
  }
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf-8')) as Subscriber[];
  } catch {
    return [];
  }
}

async function save(list: Subscriber[]): Promise<void> {
  if (redisAvailable()) {
    await redisCommand(['SET', REDIS_KEY, JSON.stringify(list)]);
    return;
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

export async function subscribe(email: string, region: string): Promise<void> {
  const normalized = email.toLowerCase();
  const list = await load();
  const existing = list.find((s) => s.email === normalized);
  if (existing) {
    existing.region = region; // 지역 변경 갱신
  } else {
    list.push({ email: normalized, region, createdAt: new Date().toISOString() });
  }
  await save(list);
}

export async function unsubscribe(email: string): Promise<boolean> {
  const normalized = email.toLowerCase();
  const list = await load();
  const next = list.filter((s) => s.email !== normalized);
  if (next.length === list.length) return false;
  await save(next);
  return true;
}

export async function isSubscribed(email: string): Promise<Subscriber | null> {
  return (await load()).find((s) => s.email === email.toLowerCase()) ?? null;
}

export async function listSubscribers(): Promise<Subscriber[]> {
  return load();
}
