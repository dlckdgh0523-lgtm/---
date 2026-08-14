/**
 * 관리자 개요 — 익명 집계 + LLM 운영 지표 + 서비스 현황.
 * 접근: ADMIN_EMAILS 화이트리스트의 JWT 세션만. 비관리자·비로그인은 404 (경로 비노출).
 * 개인 식별값(이메일·금액·계약)은 어떤 형태로도 반환하지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/server/session';
import { isAdminEmail } from '@/lib/server/admin';
import { listUserProfiles } from '@/lib/server/users';
import { listSubscribers } from '@/lib/server/subscribers';
import { readNotifyRun } from '@/lib/server/ops';
import { readLlmMetrics } from '@/lib/llm/metrics';
import { contractRiskDistribution, crossAnalysis, structureSummary } from '@/lib/server/stats';
import { loadAdminFacts } from '@/lib/server/admin-facts';
import { DAILY_LIMITS } from '@/config/roleplay';

/** 표본 30건 미만이면 수치 미노출 — 인사이트 화면과 동일 원칙 (라우트 export 제약상 비공개 상수) */
const MIN_SAMPLE = 30;

export async function GET(req: NextRequest) {
  const email = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!isAdminEmail(email)) return new Response('Not Found', { status: 404 });

  // ---- 익명 집계 (옵트인 사용자만, 이메일 미포함) ----
  const profiles = (await listUserProfiles()).filter((p) => p?.optInAnonymousStats);
  const byTier: Record<string, { n: number; advanceRates: number[]; userStructureCount: number }> = {};
  const byProduct: Record<string, number> = {};
  for (const p of profiles) {
    if (!p) continue;
    const tier = (byTier[p.companyTier] ??= { n: 0, advanceRates: [], userStructureCount: 0 });
    tier.n += 1;
    // GIGO 방지 원칙(2026-08-13): 사용자가 직접 입력한('user') 구조값만 집계
    if (p.structureSource?.advanceRate === 'user') tier.advanceRates.push(p.advanceRate);
    if (p.structureSource?.clawbackSchedule === 'user') tier.userStructureCount += 1;
    byProduct[p.mainProductLine] = (byProduct[p.mainProductLine] ?? 0) + 1;
  }

  // ---- 지역 팩 현황 ----
  let regions: { code: string; name: string; recordCount: number; builtAt: string }[] = [];
  try {
    const registry = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'regions', 'index.json'), 'utf-8'),
    ) as { regions: typeof regions };
    regions = registry.regions;
  } catch {
    regions = [];
  }

  const subscribers = await listSubscribers();

  return Response.json({
    ok: true,
    minSample: MIN_SAMPLE,
    aggregates: {
      optInCount: profiles.length,
      byTier,
      byProduct,
      // 익명 구조 레코드 기반 (2026-08-14 수집 정책) — 계약 원본은 여전히 서버에 없고,
      // 옵트인 사용자의 비식별 구조값(구간·문항·등급)만 별도 레코드로 집계된다
      riskDistribution: await contractRiskDistribution(),
      structure: await structureSummary(),
    },
    llm: {
      today: await readLlmMetrics(),
      limits: DAILY_LIMITS,
    },
    service: {
      subscriberCount: subscribers.length, // 주소 목록은 반환하지 않는다
      regions,
      lastNotifyRun: await readNotifyRun(),
    },
    // 실사용자 0명이어도 0이 아닌 실측 사실 — 파이프라인·품질·분석·QA (2026-08-14)
    facts: loadAdminFacts(),
    // 구조 데이터 교차 분석 (소속×선지급률/환수/상품, k-익명성 적용) — 제품 축적 데이터
    cross: await crossAnalysis(),
  });
}
