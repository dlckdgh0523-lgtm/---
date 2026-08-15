'use client';

/**
 * 헤더 네비게이션 — 관리자 계정으로 로그인한 경우에만 "관리자" 링크를 추가로 노출.
 * (관리자 링크가 없어 /admin 도달 경로가 없던 문제 해소 — 2026-08-14.)
 * 권한 판정 자체는 각 /api/admin 라우트가 서버에서 재확인하므로 이 링크는 편의용일 뿐이다.
 *
 * 모바일: 링크 6개를 한 줄에 나열하면 375px에서 가로로 터진다(글자가 세로로 눌림).
 * → 데스크톱(md↑)은 기존 가로 링크 그대로, 모바일은 햄버거 버튼 + 드롭다운으로만 바꾼다.
 *   데스크톱 레이아웃은 건드리지 않는다 (2026-08-16).
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
  const [open, setOpen] = useState(false); // 모바일 드롭다운
  const pathname = usePathname(); // 경로 이동(로그인 직후 포함)마다 admin 여부 재확인

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setIsAdmin(Boolean(j?.isAdmin)))
      .catch(() => {});
  }, [pathname]);

  // 경로가 바뀌면 열려 있던 모바일 메뉴를 닫는다
  useEffect(() => setOpen(false), [pathname]);

  const links = isAdmin ? [...LINKS, { href: '/admin', label: '관리자' }] : LINKS;

  return (
    <>
      {/* 데스크톱 — 기존 가로 링크 (md 이상에서만) */}
      <nav className="hidden items-center gap-4 text-sm text-slate-600 md:flex">
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

      {/* 모바일 — 햄버거 버튼 + 드롭다운 (md 미만에서만) */}
      <div className="relative md:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="메뉴 열기"
          aria-expanded={open}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
        >
          <span className="text-xl leading-none">{open ? '✕' : '☰'}</span>
        </button>
        {open && (
          <>
            {/* 바깥 클릭 시 닫기 */}
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <nav className="absolute right-0 top-12 z-50 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className={`block px-4 py-2.5 text-sm hover:bg-slate-50 ${
                    l.href === '/admin' ? 'font-semibold text-red-600' : 'text-slate-700'
                  }`}
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          </>
        )}
      </div>
    </>
  );
}
