import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 구 라우트 마이그레이션 (2026-08-13 화면 개편)
  async redirects() {
    return [
      { source: '/onboarding', destination: '/settings', permanent: false },
      { source: '/calculator', destination: '/dashboard', permanent: false },
    ];
  },
};

export default nextConfig;
