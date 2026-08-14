'use client';

/**
 * 로그인 — 원문 비밀번호는 브라우저를 벗어나지 않는다.
 * 클라이언트가 PBKDF2로 authProof(서버 검증용)를 파생해 전송하고,
 * 성공 시 같은 비밀번호에서 별도 salt로 금고 키를 파생해 금고를 함께 연다.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { deriveAuthProof, openVaultWithPassword } from '@/lib/vault';

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
      const authProof = await deriveAuthProof(email, password); // 원문 대신 파생 해시만 전송
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, authProof }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.message ?? '로그인에 실패했습니다.');
        return;
      }
      await openVaultWithPassword(email, password); // 같은 비밀번호로 금고 자동 열림 (키는 로컬에만)
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
