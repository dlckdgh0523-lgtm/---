/**
 * Jest — next/jest 프리셋 (SWC 변환, @/ 경로 매핑 자동).
 * 대상: 계산 로직 단위 테스트 (src/lib/__tests__) — "숫자는 코드가 만든다" 원칙의 실검증.
 * testEnvironment는 node — WebCrypto(globalThis.crypto)는 Node 18+ 내장.
 */
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

export default createJestConfig({
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
});
