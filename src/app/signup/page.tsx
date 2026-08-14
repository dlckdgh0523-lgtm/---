'use client';

/**
 * 회원가입 — 받는 것은 이메일과 비밀번호뿐 (이름 등 추가 개인정보 수집 금지 — 2026-08-14 지시).
 * 원문 비밀번호는 브라우저를 벗어나지 않는다: authProof(파생 해시)만 서버로 전송.
 * 메일 구독은 계정과 분리 — 설정 화면에서 별도로 등록한다.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { deriveAuthProof, openVaultWithPassword } from '@/lib/vault';

export default function SignupPage() {
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
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, authProof }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.message ?? '가입에 실패했습니다.');
        return;
      }
      await openVaultWithPassword(email, password); // 금고 자동 열림 (키는 로컬에만)
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
      <p className="mt-1 text-sm text-[#4E5968]">
        이메일 계정 하나면 어느 기기에서든 이어서 쓸 수 있습니다. 수집 항목은 이메일과 비밀번호(해시)뿐입니다.
      </p>

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
          placeholder="비밀번호 (6자 이상)"
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm focus:border-[#3182F6] focus:outline-none"
        />
        <p className="rounded-2xl bg-[#F9FAFB] p-3 text-xs leading-relaxed text-[#4E5968]">
          비밀번호는 로그인 확인과 <b>금액 데이터 암호화(금고)</b>에 함께 쓰입니다. 원문은 서버로 전송되지 않으며,
          30분간 활동이 없으면 금고가 자동으로 잠깁니다.
        </p>
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
