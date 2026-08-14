/**
 * 브라우저 localStorage 저장 — 개인정보 원칙 (PRD §8.2):
 * 프로필·계약(금액 포함)은 여기에만 저장한다. 서버 전송 경로가 없다.
 */
import type { AgentProfile, Contract } from '@/types';

const KEYS = {
  profile: 'ifc.profile.v1',
  contracts: 'ifc.contracts.v1',
} as const;

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadProfile(): AgentProfile | null {
  if (typeof window === 'undefined') return null;
  const profile = safeParse<AgentProfile>(window.localStorage.getItem(KEYS.profile));
  if (profile) {
    // 마이그레이션: structureSource 도입(2026-08-13) 이전에 저장된 프로필
    if (!profile.structureSource) {
      profile.structureSource = { advanceRate: 'default', clawbackSchedule: 'default' };
    }
    // 마이그레이션: recentCommissions[3] → avgCommission3m (2026-08-13 화면 개편)
    const legacy = profile as AgentProfile & { recentCommissions?: [number, number, number] };
    if (profile.avgCommission3m == null && legacy.recentCommissions) {
      const [a, b, c] = legacy.recentCommissions;
      profile.avgCommission3m = Math.round((a + b + c) / 3);
    }
    if (profile.avgCommission3m == null) profile.avgCommission3m = 0;
    // 마이그레이션: region 'yongsan' → 시군구코드 '11170' (2026-08-13 지역 아키텍처 개편)
    if ((profile.region as string) === 'yongsan') profile.region = '11170';
  }
  return profile;
}

export function saveProfile(profile: AgentProfile): void {
  window.localStorage.setItem(KEYS.profile, JSON.stringify(profile));
}

export function loadContracts(): Contract[] {
  if (typeof window === 'undefined') return [];
  return safeParse<Contract[]>(window.localStorage.getItem(KEYS.contracts)) ?? [];
}

export function saveContracts(contracts: Contract[]): void {
  window.localStorage.setItem(KEYS.contracts, JSON.stringify(contracts));
}

export function clearAll(): void {
  window.localStorage.removeItem(KEYS.profile);
  window.localStorage.removeItem(KEYS.contracts);
}
