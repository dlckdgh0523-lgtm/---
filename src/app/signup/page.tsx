'use client';

/** 회원가입 — 이메일 계정 생성 + 이 시점에 메일 수신 동의(기본 OFF)를 받는다. 가입 후 온보딩(/settings)으로. */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [optIn, setOptIn] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, emailOptIn: optIn }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.message ?? '가입에 실패했습니다.');
        return;
      }
      router.push('/settings'); // 가입 직후 온보딩
    } catch {
      setError('네트워크 오류 — 다시 시도하세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm py-12">
      <h1 className="text-2xl font-extrabold text-[#191F28]">회원가입</h1>
      <p className="mt-1 text-sm text-[#4E5968]">이메일 계정 하나면 어느 기기에서든 이어서 쓸 수 있습니다.</p>

      <div className="mt-6 space-y-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="이메일"
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm focus:border-[#3182F6] focus:outline-none"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호 (6자 이상)"
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm focus:border-[#3182F6] focus:outline-none"
        />
        <label className="flex items-start gap-2 rounded-2xl bg-[#F9FAFB] p-3 text-sm text-[#4E5968]">
          <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} className="mt-0.5" />
          <span>
            매일 오전 10시 "오늘의 접점" 메일을 받습니다 (선택). 접점 정보만 발송되며 메일 하단 링크로 언제든 해제할
            수 있습니다.
          </span>
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          onClick={submit}
          disabled={busy || !email || password.length < 6}
          className="w-full rounded-2xl bg-[#3182F6] py-3 font-bold text-white transition hover:bg-[#1B64DA] disabled:bg-slate-300"
        >
          {busy ? '가입 중…' : '가입하고 시작하기'}
        </button>
      </div>

      <p className="mt-4 text-center text-sm text-[#4E5968]">
        이미 계정이 있나요?{' '}
        <Link href="/login" className="font-semibold text-[#3182F6]">로그인</Link>
      </p>
    </div>
  );
}
