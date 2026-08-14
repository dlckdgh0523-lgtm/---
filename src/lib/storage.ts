/**
 * 브라우저 localStorage — 금고(vault) 도입 후의 역할 (2026-08-14):
 * - 계약(금액 포함)은 vault.ts가 AES-GCM 암호문으로만 저장한다 (평문 저장 금지).
 * - 프로필은 서버(/api/me)가 단일 출처 — 평문 로컬 캐시는 폐기했다.
 *   여기 남은 함수는 금고 도입 "이전" 평문 데이터의 이관·정리 전용이다.
 */
import type { AgentProfile } from '@/types';

const LEGACY_KEYS = {
  profile: 'ifc.profile.v1',
  contracts: 'ifc.contracts.v1', // 평문 계약 — 이관은 vault.ts의 loadVaultContracts가 수행
} as const;

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 구버전 평문 프로필 읽기 — 계정 이관(1회)용. 이관 후 clearLegacyProfile()로 삭제할 것. */
export function loadLegacyProfile(): AgentProfile | null {
  if (typeof window === 'undefined') return null;
  const profile = safeParse<AgentProfile>(window.localStorage.getItem(LEGACY_KEYS.profile));
  if (profile) {
    if (!profile.structureSource) {
      profile.structureSource = { advanceRate: 'default', clawbackSchedule: 'default' };
    }
    const legacy = profile as AgentProfile & { recentCommissions?: [number, number, number] };
    if (profile.avgCommission3m == null && legacy.recentCommissions) {
      const [a, b, c] = legacy.recentCommissions;
      profile.avgCommission3m = Math.round((a + b + c) / 3);
    }
    if (profile.avgCommission3m == null) profile.avgCommission3m = 0;
    if ((profile.region as string) === 'yongsan') profile.region = '11170';
  }
  return profile;
}

export function clearLegacyProfile(): void {
  window.localStorage.removeItem(LEGACY_KEYS.profile);
}

/** 로그아웃/계정 정리 — 평문 잔재와 암호문 모두 제거 */
export function clearAll(): void {
  window.localStorage.removeItem(LEGACY_KEYS.profile);
  window.localStorage.removeItem(LEGACY_KEYS.contracts);
  window.localStorage.removeItem('ifc.contracts.v2');
}
