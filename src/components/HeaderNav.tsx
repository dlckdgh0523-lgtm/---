'use client';

/**
 * 헤더 네비게이션 — 관리자 계정으로 로그인한 경우에만 "관리자" 링크를 추가로 노출.
 * (관리자 링크가 없어 /admin 도달 경로가 없던 문제 해소 — 2026-08-14.)
 * 권한 판정 자체는 각 /api/admin 라우트가 서버에서 재확인하므로 이 링크는 편의용일 뿐이다.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/dashboard', label: '대시보드' },
  { href: '/places', label: '접점 지도' },
  { href: '/outreach', label: '홍보 포인트' },
  { href: '/contracts', label: '계약' },
  { href: '/insights', label: '인사이트' },
  { href: '/settings', label: '설정' },
];

export default function HeaderNav() {
  const [isAdmin, setIsAdmin] = useState(false);
  const pathname = usePathname(); // 경로 이동(로그인 직후 포함)마다 admin 여부 재확인

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setIsAdmin(Boolean(j?.isAdmin)))
      .catch(() => {});
  }, [pathname]);

  return (
    <nav className="flex items-center gap-4 text-sm text-slate-600">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className="hover:text-[#3182F6]">
          {l.label}
        </Link>
      ))}
      {isAdmin && (
        <Link href="/admin" className="font-semibold text-red-600 hover:text-red-700">
          관리자
        </Link>
      )}
    </nav>
  );
}
