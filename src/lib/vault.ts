'use client';

/**
 * 금고(vault) — 금액 데이터의 클라이언트 암호화 계층. (2026-08-14 지시)
 *
 * 키 계층 (원문 비밀번호는 이 파일 밖으로, 그리고 브라우저 밖으로 절대 나가지 않는다):
 *   비밀번호 ─ PBKDF2(salt="ifc-auth-v1:<email>")  → authProof  → 서버 전송 (로그인 검증용)
 *            └ PBKDF2(salt="ifc-vault-v1:<email>") → vault key  → 메모리에만 (AES-GCM, 추출 불가)
 *   서버가 받는 것은 authProof뿐이고, 서버는 그것을 다시 scrypt로 해시해 저장한다.
 *   두 파생은 salt(용도 구분자)가 달라 서로 계산해낼 수 없다.
 *
 * 잠금:
 *   30분(IDLE_LOCK_MS) 동안 클릭·키입력·스크롤이 없으면 키와 복호화 캐시를 지운다.
 *   잠금 화면(VaultGate)은 자식 컴포넌트를 언마운트시켜 React 상태의 금액 데이터도
 *   참조가 끊기게 한다. (JS는 메모리 명시 소거를 보장하지 못한다 — 키를 추출 불가
 *   CryptoKey로 만들고 참조를 끊는 것이 브라우저에서 가능한 최선. README 정직 기록)
 *   JWT 세션은 이 타이머와 무관하게 유지된다 — 금액 없는 화면은 계속 쓸 수 있다.
 */
import type { Contract } from '@/types';

export const IDLE_LOCK_MS = 30 * 60 * 1000; // 30분 — 지시 고정값 (검증은 15초·60초 임시값으로 수행 후 원복)
const PBKDF2_ITERATIONS = 300_000; // PBKDF2-SHA256 [미검증 가설: OWASP 권고 범위 내 데모 절충]
const CONTRACTS_KEY = 'ifc.contracts.v2'; // {iv, ct} — AES-GCM 암호문
const LEGACY_CONTRACTS_KEY = 'ifc.contracts.v1'; // 평문 (금고 도입 전) — 첫 열림 때 암호화 이관 후 삭제

// ---------- 파생 ----------

async function pbkdf2Bits(password: string, salt: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS },
    material,
    256,
  );
}

/** 서버 전송용 인증 증명 — 원문 비밀번호 대신 이것만 네트워크를 탄다. */
export async function deriveAuthProof(email: string, password: string): Promise<string> {
  const bits = await pbkdf2Bits(password, `ifc-auth-v1:${email.toLowerCase()}`);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 금고 키 — 서버로 전송되지 않는다. 추출 불가 CryptoKey. */
async function deriveVaultKey(email: string, password: string): Promise<CryptoKey> {
  const bits = await pbkdf2Bits(password, `ifc-vault-v1:${email.toLowerCase()}`);
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// ---------- 금고 상태 (모듈 싱글턴) ----------

let vaultKey: CryptoKey | null = null;
let vaultEmail: string | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = ['click', 'keydown', 'scroll', 'touchstart'];

function notify(): void {
  listeners.forEach((cb) => cb());
}

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => lockVault(), IDLE_LOCK_MS);
}

function attachActivityListeners(): void {
  if (typeof window === 'undefined') return; // 테스트(node) 환경 가드
  ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, resetIdleTimer, { passive: true }));
}

function detachActivityListeners(): void {
  if (typeof window === 'undefined') return;
  ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, resetIdleTimer));
}

export function isVaultUnlocked(): boolean {
  return vaultKey !== null;
}

export function onVaultChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 잠금 — 키·복호화 캐시 참조를 끊는다. JWT 세션은 건드리지 않는다. */
export function lockVault(): void {
  vaultKey = null;
  vaultEmail = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  detachActivityListeners();
  notify();
}

function openVault(email: string, key: CryptoKey): void {
  vaultKey = key;
  vaultEmail = email.toLowerCase();
  attachActivityListeners();
  resetIdleTimer();
  notify();
}

/**
 * 로그인/가입 직후 호출 — 이미 서버 검증에 성공한 비밀번호로 금고를 연다.
 * (별도 패스프레이즈를 외울 필요가 없게 로그인과 금고 열림을 겸한다)
 */
export async function openVaultWithPassword(email: string, password: string): Promise<void> {
  openVault(email, await deriveVaultKey(email, password));
}

/**
 * 잠금 해제 — 비밀번호를 서버(로그인 라우트)로 재검증한 뒤에만 키를 다시 파생한다.
 * 서버 검증 성공 = JWT도 갱신된다. 원문 비밀번호는 전송되지 않는다(authProof만).
 */
export async function unlockVault(email: string, password: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const authProof = await deriveAuthProof(email, password);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, authProof }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      return { ok: false, message: json.message ?? '비밀번호가 맞지 않습니다.' };
    }
    openVault(email, await deriveVaultKey(email, password));
    return { ok: true };
  } catch {
    return { ok: false, message: '네트워크 오류 — 다시 시도하세요.' };
  }
}

// ---------- 암호화 저장 (계약 데이터) ----------

class VaultLockedError extends Error {
  constructor() {
    super('vault locked');
  }
}

async function encryptJson(value: unknown): Promise<string> {
  if (!vaultKey) throw new VaultLockedError();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, vaultKey, new TextEncoder().encode(JSON.stringify(value)));
  return JSON.stringify({
    iv: btoa(String.fromCharCode(...iv)),
    ct: btoa(String.fromCharCode(...new Uint8Array(ct))),
  });
}

async function decryptJson<T>(raw: string): Promise<T> {
  if (!vaultKey) throw new VaultLockedError();
  const { iv, ct } = JSON.parse(raw) as { iv: string; ct: string };
  const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
  const ctBytes = Uint8Array.from(atob(ct), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, vaultKey, ctBytes);
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

/** 계약 로드 — 금고 열림 상태에서만. 평문 구버전(v1)이 있으면 암호화 이관 후 삭제. */
export async function loadVaultContracts(): Promise<Contract[]> {
  if (typeof window === 'undefined' || !vaultKey) return [];
  // 평문 → 암호문 이관 (금고 도입 전 데이터)
  const legacy = window.localStorage.getItem(LEGACY_CONTRACTS_KEY);
  if (legacy) {
    try {
      const list = JSON.parse(legacy) as Contract[];
      window.localStorage.setItem(CONTRACTS_KEY, await encryptJson(list));
    } catch {
      /* 손상된 구버전 — 버린다 */
    }
    window.localStorage.removeItem(LEGACY_CONTRACTS_KEY);
  }
  const raw = window.localStorage.getItem(CONTRACTS_KEY);
  if (!raw) return [];
  try {
    return await decryptJson<Contract[]>(raw);
  } catch {
    // 다른 계정의 키로 복호화 시도(계정 전환) 또는 손상 — 빈 목록으로 시작하되 데이터는 남겨둔다
    return [];
  }
}

export async function saveVaultContracts(contracts: Contract[]): Promise<void> {
  window.localStorage.setItem(CONTRACTS_KEY, await encryptJson(contracts));
}

/** 현재 금고 소유 계정 (잠금 화면 표기용) */
export function vaultOwner(): string | null {
  return vaultEmail;
}

/**
 * 범용 암호화 블롭 — 프로필 금액 필드의 서버 저장용 (2026-08-14).
 * 서버는 이 문자열({iv, ct})만 보관하며 내용을 열 수 없다.
 */
export async function sealJson(value: unknown): Promise<string> {
  return encryptJson(value);
}

export async function openJson<T>(raw: string): Promise<T> {
  return decryptJson<T>(raw);
}
