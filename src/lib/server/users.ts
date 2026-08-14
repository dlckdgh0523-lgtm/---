/**
 * 사용자 테이블 — 파일 기반 (data/users.json, gitignore 대상). 서버 전용.
 *
 * ⚠️ 판단 변경 (2026-08-13, 사용자 지시): 계정 도입과 함께 프로필(보유현금 포함)을 서버에 저장한다.
 *    Phase 0의 "금액은 로컬만" 원칙의 예외 — 크로스 기기 사용을 위한 명시적 결정 (MEMORY.md).
 *    계약(계약자별 금액)은 여전히 브라우저 로컬에만 있다.
 * ⚠️ Vercel 서버리스는 파일시스템이 휘발성 — 프로덕션은 DB로 교체 (README).
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

const FILE = path.join(process.cwd(), 'data', 'users.json');

function load(): UserRecord[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf-8')) as UserRecord[];
  } catch {
    return [];
  }
}

function save(list: UserRecord[]): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

function hash(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function findUser(email: string): UserRecord | null {
  return load().find((u) => u.email === email.toLowerCase()) ?? null;
}

export function createUser(email: string, password: string, emailOptIn: boolean): UserRecord | null {
  const normalized = email.toLowerCase();
  const list = load();
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
  save(list);
  return user;
}

export function verifyPassword(email: string, password: string): UserRecord | null {
  const user = findUser(email);
  if (!user) return null;
  const candidate = hash(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(user.passwordHash)) ? user : null;
}

export function updateUser(email: string, patch: { profile?: AgentProfile; emailOptIn?: boolean }): UserRecord | null {
  const list = load();
  const user = list.find((u) => u.email === email.toLowerCase());
  if (!user) return null;
  if (patch.profile !== undefined) user.profile = patch.profile;
  if (patch.emailOptIn !== undefined) user.emailOptIn = patch.emailOptIn;
  user.updatedAt = new Date().toISOString();
  save(list);
  return user;
}

/** 발송 대상: 수신 동의 + 온보딩(지역) 완료 사용자 */
export function listNotifyRecipients(): { email: string; region: string }[] {
  return load()
    .filter((u) => u.emailOptIn && u.profile?.region)
    .map((u) => ({ email: u.email, region: u.profile!.region }));
}
