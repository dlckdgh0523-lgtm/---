'use client';

/**
 * 금고 게이트 — 금액이 보이는 화면(대시보드·계약·설정)을 감싼다.
 * 잠금 상태면 자식을 "언마운트"시킨다 (오버레이로 가리는 방식 금지 — 지시).
 * 언마운트로 React 상태의 복호화된 금액 데이터 참조가 끊긴다.
 * 접점 지도 등 금액 없는 화면은 이 게이트를 쓰지 않으므로 잠금과 무관하게 동작한다.
 */
import { useEffect, useState } from 'react';
import { useAccount } from '@/lib/account';
import { isVaultUnlocked, onVaultChange, unlockVault } from '@/lib/vault';

export default function VaultGate({ children }: { children: React.ReactNode }) {
  const { status, email } = useAccount();
  const [unlocked, setUnlocked] = useState(isVaultUnlocked);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => onVaultChange(() => setUnlocked(isVaultUnlocked())), []);

  if (status !== 'ready' && status !== 'noProfile') return null;

  if (unlocked) return <>{children}</>;

  async function submit() {
    if (!email || !password) return;
    setBusy(true);
    setError('');
    const r = await unlockVault(email, password);
    if (!r.ok) setError(r.message ?? '잠금 해제 실패');
    setPassword('');
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-sm py-16 text-center">
      <p className="text-5xl">🔒</p>
      <h1 className="mt-3 text-xl font-extrabold text-[#191F28]">금고가 잠겨 있습니다</h1>
      <p className="mt-2 text-sm leading-relaxed text-[#4E5968]">
        금액 데이터는 30분간 활동이 없으면 메모리에서 지워지고 자동으로 잠깁니다.
        <br />
        비밀번호를 입력하면 이 기기에서 다시 복호화합니다.
      </p>
      <div className="mt-6 space-y-3 text-left">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder={`${email ?? ''}의 비밀번호`}
          autoFocus
          className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm focus:border-[#3182F6] focus:outline-none"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          onClick={() => void submit()}
          disabled={busy || !password}
          className="w-full rounded-2xl bg-[#3182F6] py-3 font-bold text-white transition hover:bg-[#1B64DA] disabled:bg-slate-300"
        >
          {busy ? '확인 중…' : '금고 열기'}
        </button>
      </div>
      <p className="mt-4 text-xs text-slate-400">
        잠금 중에도 접점 지도·홍보 포인트 등 금액이 없는 화면은 계속 쓸 수 있습니다.
      </p>
    </div>
  );
}
