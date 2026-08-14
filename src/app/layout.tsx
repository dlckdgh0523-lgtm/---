import type { Metadata } from 'next';
import Link from 'next/link';
import HeaderNav from '@/components/HeaderNav';
import './globals.css';

export const metadata: Metadata = {
  title: '인톡 | 이창호 사전과제',
  description: '저연차 보험설계사의 접점 고갈과 자금 구조 무지를 다루는 도구',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-[#F9FAFB] text-[#191F28] antialiased">
        {/* 헤더 — 모든 화면 상단 필수 노출 */}
        <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-bold tracking-tight">
              인톡 <span className="font-normal text-slate-400">|</span> 이창호 사전과제
            </Link>
            <HeaderNav />
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>

        <footer className="mt-12 border-t border-slate-200 bg-white px-4 py-6 text-center text-xs leading-relaxed text-slate-500">
          <p>
            본 계산기는 수수료 구조를 이해하기 위한 시뮬레이션이며, 실제 환수 조건은 소속사 및 상품별 계약 내용에
            따릅니다. 재무 조언이 아닙니다.
          </p>
          <p className="mt-1">세금 관련 수치는 예시값이며 세무 상담을 권장합니다.</p>
        </footer>
      </body>
    </html>
  );
}
