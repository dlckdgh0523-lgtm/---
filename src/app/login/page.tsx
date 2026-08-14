'use client';

/** 로그인 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.message ?? '로그인에 실패했습니다.');
        return;
      }
      router.push('/dashboard');
    } catch {
      setError('네트워크 오류 — 다시 시도하세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm py-12">
      <h1 className="text-2xl font-extrabold text-[#191F28]">로그인</h1>
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
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="비밀번호"
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm focus:border-[#3182F6] focus:outline-none"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          onClick={submit}
          disabled={busy || !email || !password}
          className="w-full rounded-2xl bg-[#3182F6] py-3 font-bold text-white transition hover:bg-[#1B64DA] disabled:bg-slate-300"
        >
          {busy ? '확인 중…' : '로그인'}
        </button>
      </div>
      <p className="mt-4 text-center text-sm text-[#4E5968]">
        계정이 없나요?{' '}
        <Link href="/signup" className="font-semibold text-[#3182F6]">회원가입</Link>
      </p>
    </div>
  );
}
