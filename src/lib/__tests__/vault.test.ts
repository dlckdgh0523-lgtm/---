/**
 * 금고 암호화 왕복 검증 — 암호화 → 복호화 → 원본 일치, 잘못된 키로는 실패.
 * WebCrypto는 Node 18+ 내장(globalThis.crypto) — jsdom 불필요.
 * 파생 검증: authProof(서버 전송용)는 이메일·비밀번호에 결정론적이고 64자 hex.
 */
import { deriveAuthProof, lockVault, openJson, openVaultWithPassword, sealJson } from '@/lib/vault';

const EMAIL = 'test@example.com';
const PASSWORD = 'correct-horse-battery';

afterEach(() => {
  lockVault();
});

describe('deriveAuthProof', () => {
  it('결정론적 64자 hex', async () => {
    const a = await deriveAuthProof(EMAIL, PASSWORD);
    const b = await deriveAuthProof(EMAIL, PASSWORD);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('이메일(salt) 또는 비밀번호가 다르면 다른 값', async () => {
    const base = await deriveAuthProof(EMAIL, PASSWORD);
    expect(await deriveAuthProof('other@example.com', PASSWORD)).not.toBe(base);
    expect(await deriveAuthProof(EMAIL, 'wrong-password')).not.toBe(base);
  });
});

describe('sealJson / openJson — 암호화 왕복', () => {
  it('암호화 → 복호화 → 원본 일치, 암호문에 평문 부재', async () => {
    await openVaultWithPassword(EMAIL, PASSWORD);
    const original = { cashOnHand: 800, contracts: [{ label: '비밀계약', advancePaid: 1200 }] };
    const sealed = await sealJson(original);
    expect(sealed).not.toContain('비밀계약');
    expect(sealed).not.toContain('1200');
    expect(sealed).not.toContain('800');
    const opened = await openJson<typeof original>(sealed);
    expect(opened).toEqual(original);
  });

  it('같은 평문도 매번 다른 암호문 (랜덤 IV)', async () => {
    await openVaultWithPassword(EMAIL, PASSWORD);
    const a = await sealJson({ v: 1 });
    const b = await sealJson({ v: 1 });
    expect(a).not.toBe(b);
  });

  it('잘못된 키(다른 비밀번호)로는 복호화 실패 — AES-GCM 무결성 검증', async () => {
    await openVaultWithPassword(EMAIL, PASSWORD);
    const sealed = await sealJson({ secret: true });
    lockVault();
    await openVaultWithPassword(EMAIL, 'wrong-password');
    await expect(openJson(sealed)).rejects.toThrow();
  });

  it('다른 계정(salt)의 키로도 복호화 실패', async () => {
    await openVaultWithPassword(EMAIL, PASSWORD);
    const sealed = await sealJson({ secret: true });
    lockVault();
    await openVaultWithPassword('other@example.com', PASSWORD);
    await expect(openJson(sealed)).rejects.toThrow();
  });

  it('금고 잠김 상태에서는 암호화·복호화 자체가 불가', async () => {
    await expect(sealJson({ v: 1 })).rejects.toThrow();
    await openVaultWithPassword(EMAIL, PASSWORD);
    const sealed = await sealJson({ v: 1 });
    lockVault();
    await expect(openJson(sealed)).rejects.toThrow();
  });
});
