'use client';

/**
 * 계정 클라이언트 + 페이지 가드 훅.
 *
 * 프로필 저장 구조 (2026-08-14 확정):
 * - 금액 5필드(PROFILE_MONEY_FIELDS)는 금고 키로 암호화한 moneyEnc 블롭으로만 서버에 저장.
 * - 비금액 필드(지역·소속·상품·구조)는 평문 — 집계용, 비식별.
 * - 읽기: 금고가 열려 있으면 moneyEnc를 복호화해 완전한 AgentProfile로 병합.
 *   잠겨 있으면 금액 필드는 0으로 채워 반환 — 금액을 쓰는 화면은 전부 VaultGate 뒤라
 *   잠금 상태에서 0이 화면에 노출되는 경로가 없다 (region 등 비금액만 소비됨).
 * - 구버전 서버 평문 프로필은 금고가 열린 첫 기회에 암호화 재저장(이관)한다.
 *
 * 가드 결과: guest → /login, noProfile → /settings(온보딩), ready → 렌더.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearLegacyProfile, loadLegacyProfile } from '@/lib/storage';
import { isVaultUnlocked, lockVault, openJson, sealJson } from '@/lib/vault';
import { PROFILE_MONEY_FIELDS, type AgentProfile, type ProfileMoney, type StoredProfile } from '@/types';

export interface Me {
  email: string;
  profile: AgentProfile | null;
}

const ZERO_MONEY: ProfileMoney = {
  avgCommission3m: 0,
  cashOnHand: 0,
  monthlyFixedExpense: 0,
  monthlyGoal: 0,
  companyMinimum: 0,
};

function hasPlaintextMoney(stored: StoredProfile): boolean {
  return PROFILE_MONEY_FIELDS.some((f) => typeof (stored as Record<string, unknown>)[f] === 'number');
}

/** 서버 저장 형태 → 화면용 완전 프로필. needsMigration = 서버에 평문 금액이 남아 있는 구버전 */
async function toFullProfile(stored: StoredProfile): Promise<{ profile: AgentProfile; needsMigration: boolean }> {
  if (stored.moneyEnc) {
    let money = ZERO_MONEY;
    if (isVaultUnlocked()) {
      try {
        money = await openJson<ProfileMoney>(stored.moneyEnc);
      } catch {
        /* 다른 계정 키 등 — 0으로 표시, 게이트 뒤에서만 소비됨 */
      }
    }
    return { profile: { ...(stored as Omit<StoredProfile, 'moneyEnc'>), ...money } as AgentProfile, needsMigration: false };
  }
  if (hasPlaintextMoney(stored)) {
    // 구버전: 서버에 평문 금액이 남아 있다 → 금고 열리면 암호화 이관 대상
    return { profile: stored as unknown as AgentProfile, needsMigration: true };
  }
  return { profile: { ...(stored as AgentProfile), ...ZERO_MONEY }, needsMigration: false };
}

export async function fetchMe(): Promise<{ email: string; stored: StoredProfile | null } | null> {
  try {
    const res = await fetch('/api/me', { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    return { email: json.email, stored: json.profile ?? null };
  } catch {
    return null;
  }
}

/**
 * 프로필 저장 — 금액을 금고 키로 암호화(sealJson)한 뒤 비금액+moneyEnc만 전송한다.
 * 금고가 잠겨 있으면 저장하지 않는다 (false 반환) — 저장 화면은 게이트 뒤라 정상 경로에서는 항상 열려 있다.
 */
export async function pushProfile(profile: AgentProfile): Promise<boolean> {
  try {
    const money: ProfileMoney = {
      avgCommission3m: profile.avgCommission3m,
      cashOnHand: profile.cashOnHand,
      monthlyFixedExpense: profile.monthlyFixedExpense,
      monthlyGoal: profile.monthlyGoal,
      companyMinimum: profile.companyMinimum,
    };
    const moneyEnc = await sealJson(money); // 금고 잠금 시 throw
    const stored: Record<string, unknown> = { ...profile, moneyEnc };
    for (const f of PROFILE_MONEY_FIELDS) delete stored[f]; // 평문 금액은 전송 자체를 하지 않는다
    const res = await fetch('/api/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: stored }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function logout(): Promise<void> {
  lockVault(); // 세션 종료 = 금고도 잠근다
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {
    /* ignore */
  }
}

export type AuthStatus = 'loading' | 'guest' | 'noProfile' | 'ready';

interface AuthState {
  status: AuthStatus;
  profile: AgentProfile | null;
  email: string | null;
}

/**
 * @param redirect true면 guest→/login, noProfile→/settings 자동 이동 (설정 화면은 false로 쓰고 직접 처리)
 */
export function useAccount(redirect = true): AuthState {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({ status: 'loading', profile: null, email: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await fetchMe();
      if (cancelled) return;
      if (!me) {
        setState({ status: 'guest', profile: null, email: null });
        if (redirect) router.replace('/login');
        return;
      }
      if (me.stored) {
        const { profile, needsMigration } = await toFullProfile(me.stored);
        if (cancelled) return;
        if (needsMigration && isVaultUnlocked()) {
          await pushProfile(profile); // 서버 평문 → 암호문 이관 (서버는 평문 필드를 삭제 저장)
        }
        setState({ status: 'ready', profile, email: me.email });
        return;
      }
      // 계정은 있는데 온보딩 전 — 금고 도입 이전 평문 로컬 프로필이 있으면 계정으로 이관 후 평문 삭제
      const legacy = loadLegacyProfile();
      if (legacy && isVaultUnlocked()) {
        await pushProfile(legacy);
        clearLegacyProfile();
        setState({ status: 'ready', profile: legacy, email: me.email });
        return;
      }
      setState({ status: 'noProfile', profile: null, email: me.email });
      if (redirect) router.replace('/settings');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
