/**
 * 익명 구조값 수집 + 프리셋 요약 (2026-08-14 수집 정책).
 *
 * POST: 옵트인 사용자의 구조 레코드 저장.
 *   - JWT 필수 (스팸 방지용 인증일 뿐) — 저장되는 레코드에는 이메일·계정 ID가 들어가지 않는다.
 *   - 서버가 금액성 필드를 화이트리스트 방식으로 걸러 저장한다 (임의 필드 저장 금지).
 * GET: 소속사 구분별 역산 요약 — 설정 화면 프리셋용. 표본 30건 미만은 중앙값 미제공.
 */
import { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/server/session';
import { addContractRecord, addStructureRecord, structureSummary } from '@/lib/server/stats';
import type { ClawbackBracket, ContractFactors, PremiumBand, ProductLine, RiskLevel } from '@/types';

const TIERS = ['captive-life', 'captive-nonlife', 'large-ga', 'small-ga'] as const;
const PRODUCTS: ProductLine[] = ['life', 'third', 'general', 'auto', 'savings'];
const BANDS: PremiumBand[] = ['~5', '5~10', '10~20', '20~30', '30~50', '50+'];
const LEVELS: RiskLevel[] = ['high', 'medium', 'low'];

function validSchedule(v: unknown): v is ClawbackBracket[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= 10 &&
    v.every(
      (b) =>
        typeof b?.maxMonth === 'number' && b.maxMonth >= 0 && b.maxMonth <= 120 &&
        typeof b?.clawbackRate === 'number' && b.clawbackRate >= 0 && b.clawbackRate <= 1,
    )
  );
}

export async function POST(req: NextRequest) {
  const email = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!email) return Response.json({ ok: false }, { status: 401 });

  try {
    const body = (await req.json()) as { structure?: Record<string, unknown>; contract?: Record<string, unknown> };
    const now = new Date().toISOString();

    if (body.structure) {
      const s = body.structure;
      if (!TIERS.includes(s.companyTier as (typeof TIERS)[number])) return Response.json({ ok: false }, { status: 400 });
      if (!PRODUCTS.includes(s.mainProductLine as ProductLine)) return Response.json({ ok: false }, { status: 400 });
      const advanceRate =
        typeof s.advanceRate === 'number' && s.advanceRate > 0 && s.advanceRate <= 1 ? s.advanceRate : undefined;
      const clawbackSchedule = validSchedule(s.clawbackSchedule) ? s.clawbackSchedule : undefined;
      if (!advanceRate && !clawbackSchedule) return Response.json({ ok: false, message: '직접 입력한 구조값 없음' }, { status: 400 });
      // 화이트리스트 재구성 — 클라이언트가 무엇을 보내든 이 필드만 저장된다
      await addStructureRecord({
        schemaVersion: 2,
        enteredBy: 'user',
        affiliation: (s.companyTier as string).startsWith('captive') ? 'captive' : 'ga',
        companyTier: s.companyTier as (typeof TIERS)[number],
        mainProductLine: s.mainProductLine as ProductLine,
        advanceRate,
        clawbackSchedule,
        hasCompanyMinimum: Boolean(s.hasCompanyMinimum),
        createdAt: now,
      });
    }

    if (body.contract) {
      const c = body.contract;
      if (!PRODUCTS.includes(c.productLine as ProductLine)) return Response.json({ ok: false }, { status: 400 });
      if (!BANDS.includes(c.premiumBand as PremiumBand)) return Response.json({ ok: false }, { status: 400 });
      if (!LEVELS.includes(c.riskLevel as RiskLevel)) return Response.json({ ok: false }, { status: 400 });
      const f = c.factors as ContractFactors | undefined;
      if (!f || !['acquaintance', 'referral', 'cold'].includes(f.relationship)) return Response.json({ ok: false }, { status: 400 });
      await addContractRecord({
        schemaVersion: 2,
        enteredBy: 'user',
        productLine: c.productLine as ProductLine,
        premiumBand: c.premiumBand as PremiumBand,
        factors: {
          relationship: f.relationship,
          premiumBurden: f.premiumBurden,
          motivation: f.motivation,
          autoTransfer: Boolean(f.autoTransfer),
        },
        businessCategory: typeof c.businessCategory === 'string' && c.businessCategory !== 'none' ? c.businessCategory : null,
        riskLevel: c.riskLevel as RiskLevel,
        createdAt: now,
      });
    }

    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const email = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!email) return Response.json({ ok: false }, { status: 401 });
  return Response.json({ ok: true, summary: await structureSummary() });
}
