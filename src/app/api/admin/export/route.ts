/**
 * 관리자 데이터 내보내기 — 집계값만 (개별 레코드 절대 미포함, 2026-08-14 지시 B).
 * ?format=json|csv. 파일에 생성 시각·표본 수·마스킹 기준을 함께 담는다.
 * 접근: ADMIN_EMAILS 화이트리스트. 비관리자 404.
 * k-익명성/30건 미만 마스킹이 적용된 crossAnalysis 결과를 그대로 내보내므로,
 * 내보낸 파일에도 개인 특정 가능한 값이 들어가지 않는다.
 */
import { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/server/session';
import { isAdminEmail } from '@/lib/server/admin';
import { crossAnalysis, K_ANON_MIN, STRUCTURE_MIN_SAMPLE } from '@/lib/server/stats';

const TIER_LABEL: Record<string, string> = {
  'captive-life': '전속(생보)',
  'captive-nonlife': '전속(손보)',
  'large-ga': 'GA(대형)',
  'small-ga': 'GA(중소)',
};

export async function GET(req: NextRequest) {
  const email = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!isAdminEmail(email)) return new Response('Not Found', { status: 404 });

  const format = req.nextUrl.searchParams.get('format') === 'csv' ? 'csv' : 'json';
  const cross = await crossAnalysis();
  const meta = {
    generatedAt: new Date().toISOString(),
    kAnonMin: K_ANON_MIN,
    minSample: STRUCTURE_MIN_SAMPLE,
    maskingRule: `셀 표본 ${K_ANON_MIN}건 미만은 개인 특정 방지로 차단(null), ${STRUCTURE_MIN_SAMPLE}건 미만은 통계 신뢰 부족으로 마스킹`,
    totalStructureRecords: cross.totalStructure,
    totalContractRecords: cross.totalContract,
    note: '집계값만 포함 — 개별 레코드·이메일·계정 ID 없음. 골든셋과 무관.',
  };

  if (format === 'json') {
    return new Response(JSON.stringify({ meta, data: cross }, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="ifc-stats-${meta.generatedAt.slice(0, 10)}.json"`,
      },
    });
  }

  // CSV — 소속×선지급률 + 소속×환수 점검점 (집계값만)
  const rows: string[] = [];
  rows.push('# 생성시각,' + meta.generatedAt);
  rows.push('# 마스킹기준,' + meta.maskingRule);
  rows.push('# 구조레코드,' + cross.totalStructure + ',계약레코드,' + cross.totalContract);
  rows.push('');
  rows.push('소속구분,표본수,선지급률중앙값,Q1,Q3,최소,최대,차단여부,마스킹여부');
  for (const [tier, d] of Object.entries(cross.advanceByTier)) {
    rows.push(
      [TIER_LABEL[tier] ?? tier, d.n, d.median ?? '', d.q1 ?? '', d.q3 ?? '', d.min ?? '', d.max ?? '', d.blocked ? 'Y' : 'N', d.masked ? 'Y' : 'N'].join(','),
    );
  }
  rows.push('');
  rows.push('소속구분,환수레코드수,6개월환수율,12개월,24개월');
  for (const [tier, c] of Object.entries(cross.clawbackByTier)) {
    rows.push([TIER_LABEL[tier] ?? tier, c.n, c.checkpoints[6] ?? '', c.checkpoints[12] ?? '', c.checkpoints[24] ?? ''].join(','));
  }
  rows.push('');
  rows.push('소속구분,표본수,최소치보유수');
  for (const [tier, m] of Object.entries(cross.minimumByTier)) {
    rows.push([TIER_LABEL[tier] ?? tier, m.n, m.withMinimum ?? ''].join(','));
  }

  // Excel 한글 깨짐 방지 BOM
  return new Response('﻿' + rows.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ifc-stats-${meta.generatedAt.slice(0, 10)}.csv"`,
    },
  });
}
