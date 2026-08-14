'use client';

/**
 * 계정 클라이언트 + 페이지 가드 훅.
 * 서버(/api/me)가 프로필의 단일 출처 — 평문 로컬 캐시는 폐기 (2026-08-14 금고 도입).
 * 가드 결과: guest → /login, noProfile → /settings(온보딩), ready → 렌더.
 * 이메일 구독은 계정과 분리된 시스템 (/api/notify/subscribe) — 여기서 다루지 않는다.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearLegacyProfile, loadLegacyProfile } from '@/lib/storage';
import { lockVault } from '@/lib/vault';
import type { AgentProfile } from '@/types';

export interface Me {
  email: string;
  profile: AgentProfile | null;
}

export async function fetchMe(): Promise<Me | null> {
  try {
    const res = await fetch('/api/me', { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    return { email: json.email, profile: json.profile ?? null };
  } catch {
    return null;
  }
}

export async function pushProfile(profile: AgentProfile): Promise<boolean> {
  try {
    const res = await fetch('/api/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
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
      if (me.profile) {
        setState({ status: 'ready', profile: me.profile, email: me.email });
        return;
      }
      // 계정은 있는데 온보딩 전 — 금고 도입 이전 평문 프로필이 있으면 계정으로 이관 후 평문 삭제
      const legacy = loadLegacyProfile();
      if (legacy) {
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
