/**
 * 사용자 테이블 — 서버 전용.
 *
 * 저장 항목은 이메일, 인증 해시(authProof의 scrypt), salt, 프로필, 생성/수정 시각뿐이다.
 * 이름 등 추가 개인정보는 받지 않는다 (2026-08-14 지시).
 *
 * ⚠️ 인증 구조 (2026-08-14 확정 — README §로그인/금고):
 *   서버는 원문 비밀번호를 절대 받지 않는다. 클라이언트가 PBKDF2로 파생한
 *   "인증용 증명(authProof)"만 전송되고, 서버는 그것을 다시 scrypt로 해시해 저장한다.
 *   같은 비밀번호에서 별도 salt로 파생되는 "금고 키(vault key)"는 클라이언트를
 *   벗어나지 않는다 — 서버 코드 어디에도 원문 비밀번호와 금고 키가 존재할 수 없다.
 *
 * 저장 백엔드:
 * - Redis (Upstash REST): 환경변수 있으면 사용. Vercel 서버리스는 파일시스템이
 *   읽기 전용이라 배포에서는 이것이 유일한 저장 수단 (2026-08-14 결정, MEMORY).
 * - 파일 (data/users.json, gitignore): 로컬 개발 폴백.
 *
 * ⚠️ 판단 변경 (2026-08-13, 사용자 지시): 프로필(보유현금 포함)은 크로스 기기용으로
 *   서버 저장 유지. 계약(계약자별 금액)은 브라우저 로컬(금고 암호화)에만 있다.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { redisAvailable, redisCommand } from '@/lib/server/redis';
import type { StoredProfile } from '@/types';

export interface UserRecord {
  email: string;
  authHash: string; // scrypt(authProof, salt) — authProof는 클라이언트가 PBKDF2로 파생한 64자 hex
  salt: string;
  profile: StoredProfile | null; // 온보딩 완료 전 null. 금액은 moneyEnc 암호문으로만 (2026-08-14)
  createdAt: string;
  updatedAt: string;
}

const FILE = path.join(process.cwd(), 'data', 'users.json');
const REDIS_KEY = 'ifc:users:v2'; // v2 — authProof 방식 전환으로 구계정 전면 폐기 (2026-08-14)

async function load(): Promise<UserRecord[]> {
  if (redisAvailable()) {
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
  if (redisAvailable()) {
    await redisCommand(['SET', REDIS_KEY, JSON.stringify(list)]);
    return;
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

function hash(authProof: string, salt: string): string {
  return crypto.scryptSync(authProof, salt, 64).toString('hex');
}

/** authProof 형태 검증 — PBKDF2-SHA256 256비트 hex. 원문 비밀번호가 오면 여기서 걸러진다. */
export function isValidAuthProof(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}

export async function findUser(email: string): Promise<UserRecord | null> {
  return (await load()).find((u) => u.email === email.toLowerCase()) ?? null;
}

export async function createUser(email: string, authProof: string): Promise<UserRecord | null> {
  const normalized = email.toLowerCase();
  const list = await load();
  if (list.some((u) => u.email === normalized)) return null; // 중복
  const salt = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  const user: UserRecord = {
    email: normalized,
    authHash: hash(authProof, salt),
    salt,
    profile: null,
    createdAt: now,
    updatedAt: now,
  };
  list.push(user);
  await save(list);
  return user;
}

export async function verifyAuthProof(email: string, authProof: string): Promise<UserRecord | null> {
  const user = await findUser(email);
  if (!user) return null;
  const candidate = hash(authProof, user.salt);
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(user.authHash)) ? user : null;
}

/** 관리자 익명 집계용 — 이메일은 반환하지 않는다. 프로필 금액은 애초에 암호문(moneyEnc)이라 서버가 열 수 없다. */
export async function listUserProfiles(): Promise<(StoredProfile | null)[]> {
  return (await load()).map((u) => u.profile);
}

export async function updateUser(email: string, patch: { profile?: StoredProfile }): Promise<UserRecord | null> {
  const list = await load();
  const user = list.find((u) => u.email === email.toLowerCase());
  if (!user) return null;
  if (patch.profile !== undefined) user.profile = patch.profile;
  user.updatedAt = new Date().toISOString();
  await save(list);
  return user;
}
