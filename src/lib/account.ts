'use client';

/**
 * 계정 클라이언트 + 페이지 가드 훅.
 * 서버(/api/me)가 프로필의 단일 출처이고 localStorage는 캐시로만 쓴다.
 * 가드 결과: guest → /login, noProfile → /settings(온보딩), ready → 렌더.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadProfile, saveProfile } from '@/lib/storage';
import type { AgentProfile } from '@/types';

export interface Me {
  email: string;
  emailOptIn: boolean;
  profile: AgentProfile | null;
}

export async function fetchMe(): Promise<Me | null> {
  try {
    const res = await fetch('/api/me', { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    return { email: json.email, emailOptIn: json.emailOptIn, profile: json.profile ?? null };
  } catch {
    return null;
  }
}

export async function pushProfile(profile: AgentProfile, emailOptIn?: boolean): Promise<boolean> {
  saveProfile(profile); // 로컬 캐시
  try {
    const res = await fetch('/api/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailOptIn === undefined ? { profile } : { profile, emailOptIn }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function logout(): Promise<void> {
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
  emailOptIn: boolean;
}

/**
 * @param redirect true면 guest→/login, noProfile→/settings 자동 이동 (설정 화면은 false로 쓰고 직접 처리)
 */
export function useAccount(redirect = true): AuthState {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({ status: 'loading', profile: null, email: null, emailOptIn: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = await fetchMe();
      if (cancelled) return;
      if (!me) {
        setState({ status: 'guest', profile: null, email: null, emailOptIn: false });
        if (redirect) router.replace('/login');
        return;
      }
      if (me.profile) {
        saveProfile(me.profile); // 캐시 동기화
        setState({ status: 'ready', profile: me.profile, email: me.email, emailOptIn: me.emailOptIn });
        return;
      }
      // 계정은 있는데 온보딩 전 — 구버전 로컬 프로필이 있으면 계정으로 이관
      const legacy = loadProfile();
      if (legacy) {
        await pushProfile(legacy);
        setState({ status: 'ready', profile: legacy, email: me.email, emailOptIn: me.emailOptIn });
        return;
      }
      setState({ status: 'noProfile', profile: null, email: me.email, emailOptIn: me.emailOptIn });
      if (redirect) router.replace('/settings');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
