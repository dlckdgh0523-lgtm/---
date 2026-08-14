/**
 * 사용자 테이블 — 서버 전용. 저장 백엔드 2종:
 *
 * - Redis (Upstash REST): KV_REST_API_URL/KV_REST_API_TOKEN 또는
 *   UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN이 있으면 사용.
 *   Vercel 서버리스는 파일시스템이 읽기 전용이라 배포에서는 이것이 유일한 저장 수단이다.
 *   (2026-08-14 판단 변경: 배포에서 회원가입 400 재현 — 파일 쓰기가 서버리스에서 throw.
 *    /tmp 폴백은 함수 인스턴스 간 비공유라 시연 중 세션 유실 위험이 있어 기각, Redis 채택.)
 * - 파일 (data/users.json, gitignore 대상): 로컬 개발 폴백. Redis 환경변수 없으면 사용.
 *
 * ⚠️ 판단 변경 (2026-08-13, 사용자 지시): 계정 도입과 함께 프로필(보유현금 포함)을 서버에 저장한다.
 *    Phase 0의 "금액은 로컬만" 원칙의 예외 — 크로스 기기 사용을 위한 명시적 결정 (MEMORY.md).
 *    계약(계약자별 금액)은 여전히 브라우저 로컬에만 있다.
 * 비밀번호는 scrypt 해시 + 사용자별 salt. 평문 저장 금지.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentProfile } from '@/types';

export interface UserRecord {
  email: string;
  passwordHash: string;
  salt: string;
  emailOptIn: boolean; // 오늘의 접점 메일 수신 동의 — 가입 시 선택, 기본 false
  profile: AgentProfile | null; // 온보딩 완료 전 null
  createdAt: string;
  updatedAt: string;
}

// ---------- 저장 백엔드 ----------

const FILE = path.join(process.cwd(), 'data', 'users.json');
const REDIS_KEY = 'ifc:users';

function redisEnv(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function redisCommand(cmd: string[]): Promise<unknown> {
  const env = redisEnv();
  if (!env) throw new Error('redis env missing');
  const res = await fetch(env.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  return ((await res.json()) as { result: unknown }).result;
}

async function load(): Promise<UserRecord[]> {
  if (redisEnv()) {
    const raw = (await redisCommand(['GET', REDIS_KEY])) as string | null;
    return raw ? (JSON.parse(raw) as UserRecord[]) : [];
  }
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf-8')) as UserRecord[];
  } catch {
    return [];
  }
}

async function save(list: UserRecord[]): Promise<void> {
  if (redisEnv()) {
    await redisCommand(['SET', REDIS_KEY, JSON.stringify(list)]);
    return;
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

// ---------- 도메인 로직 ----------

function hash(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export async function findUser(email: string): Promise<UserRecord | null> {
  return (await load()).find((u) => u.email === email.toLowerCase()) ?? null;
}

export async function createUser(email: string, password: string, emailOptIn: boolean): Promise<UserRecord | null> {
  const normalized = email.toLowerCase();
  const list = await load();
  if (list.some((u) => u.email === normalized)) return null; // 중복
  const salt = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  const user: UserRecord = {
    email: normalized,
    passwordHash: hash(password, salt),
    salt,
    emailOptIn,
    profile: null,
    createdAt: now,
    updatedAt: now,
  };
  list.push(user);
  await save(list);
  return user;
}

export async function verifyPassword(email: string, password: string): Promise<UserRecord | null> {
  const user = await findUser(email);
  if (!user) return null;
  const candidate = hash(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(user.passwordHash)) ? user : null;
}

export async function updateUser(
  email: string,
  patch: { profile?: AgentProfile; emailOptIn?: boolean },
): Promise<UserRecord | null> {
  const list = await load();
  const user = list.find((u) => u.email === email.toLowerCase());
  if (!user) return null;
  if (patch.profile !== undefined) user.profile = patch.profile;
  if (patch.emailOptIn !== undefined) user.emailOptIn = patch.emailOptIn;
  user.updatedAt = new Date().toISOString();
  await save(list);
  return user;
}

/** 발송 대상: 수신 동의 + 온보딩(지역) 완료 사용자 */
export async function listNotifyRecipients(): Promise<{ email: string; region: string }[]> {
  return (await load())
    .filter((u) => u.emailOptIn && u.profile?.region)
    .map((u) => ({ email: u.email, region: u.profile!.region }));
}
