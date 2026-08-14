/**
 * 관리자 화면용 실측 사실 — 실사용자가 0명이어도 0이 아닌 값들 (2026-08-14).
 * 파이프라인 산출물(meta.json·survival.json)에서 읽고, 스크립트 실측 상수는 출처와 함께 명시한다.
 * 개인 식별값 없음 — 데이터셋 통계·분석 결과·품질 지표뿐.
 */
import fs from 'node:fs';
import path from 'node:path';

const REGIONS_DIR = path.join(process.cwd(), 'public', 'data', 'regions');

interface MetaStats {
  scanned: number;
  inRegion: number;
  open: number;
  noCoord: number;
  outOfBbox: number;
  coordCrs: string;
  crsHitRate: Record<string, string>;
  sbizCountInRegion: number;
}
interface RegionMeta {
  sigunguCode: string;
  name: string;
  generatedAt: string;
  recordCount: number;
  datasets: { file: string; kind: string; encoding: string; crs: string }[];
  stats: MetaStats;
  distribution: Record<string, number>;
}

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export interface AdminFacts {
  pipeline: {
    regions: { code: string; name: string; recordCount: number; builtAt: string; distribution: Record<string, number> }[];
    // 기준 지역(용산) 원본 스캔 통계
    baseScan: { scanned: number; inRegion: number; open: number; noCoord: number } | null;
    datasets: { file: string; encoding: string; crs: string }[];
  };
  dataQuality: {
    coordCrs: string;
    crsHitRate: Record<string, string>;
    coordMissing: number;
    // 아래 3개는 별도 분석 스크립트(analyze-join.ts / check-relicense.ts) 실측값 — meta에 저장되지 않아 상수로 명시
    joinMatchRate: number; // 0.920 (analyze-join.ts, 6,542/7,113)
    joinNote: string;
    crsMedianError: string; // "5174 2.1m vs 2097 254.9m"
    relicenseSuspectPct: number; // 0.056 (check-relicense.ts, 39/699 최근 13개월)
    relicenseNote: string;
  };
  analysis: {
    survivalSample: { total: number; closed: number; open: number } | null;
    industryGapPct: number | null; // 최고-최저 24개월 생존율 격차
    industryRange: { low: string; lowSurv: number; high: string; highSurv: number } | null;
    maskedBelowSample: number; // 30건 미만으로 마스킹된 업종 수
    minSample: number;
  };
  quality: {
    jestSuites: number;
    jestCases: number;
    jestPassing: boolean;
    ci: string;
    dockerVerified: boolean;
    note: string;
  };
}

export function loadAdminFacts(): AdminFacts {
  // 레지스트리 → 지역별 meta
  const registry = readJson<{ regions: { code: string; name: string; recordCount: number; builtAt: string }[] }>(
    path.join(REGIONS_DIR, 'index.json'),
  );
  const regionList = registry?.regions ?? [];
  const regions = regionList.map((r) => {
    const meta = readJson<RegionMeta>(path.join(REGIONS_DIR, r.code, 'meta.json'));
    return {
      code: r.code,
      name: r.name,
      recordCount: r.recordCount,
      builtAt: r.builtAt,
      distribution: meta?.distribution ?? {},
    };
  });

  const baseMeta = readJson<RegionMeta>(path.join(REGIONS_DIR, '11170', 'meta.json'));
  const baseStats = baseMeta?.stats ?? null;

  // 생존 분석 (기준 지역)
  const survival = readJson<{
    sample: { total: number; closed: number; open: number };
    cond24at6: { byCategory: Record<string, { survival: number; reliable: boolean; atRisk: number }> };
  }>(path.join(REGIONS_DIR, '11170', 'survival.json'));

  let industryGapPct: number | null = null;
  let industryRange: AdminFacts['analysis']['industryRange'] = null;
  let masked = 0;
  if (survival?.cond24at6?.byCategory) {
    const entries = Object.entries(survival.cond24at6.byCategory);
    const reliable = entries.filter(([, v]) => v.reliable);
    masked = entries.length - reliable.length;
    if (reliable.length > 0) {
      const sorted = [...reliable].sort((a, b) => a[1].survival - b[1].survival);
      const low = sorted[0];
      const high = sorted[sorted.length - 1];
      industryGapPct = Math.round((high[1].survival - low[1].survival) * 1000) / 10;
      industryRange = {
        low: low[0],
        lowSurv: Math.round(low[1].survival * 1000) / 10,
        high: high[0],
        highSurv: Math.round(high[1].survival * 1000) / 10,
      };
    }
  }

  return {
    pipeline: {
      regions,
      baseScan: baseStats
        ? { scanned: baseStats.scanned, inRegion: baseStats.inRegion, open: baseStats.open, noCoord: baseStats.noCoord }
        : null,
      datasets: (baseMeta?.datasets ?? []).map((d) => ({ file: d.file, encoding: d.encoding, crs: d.crs })),
    },
    dataQuality: {
      coordCrs: baseStats?.coordCrs ?? 'EPSG:5174',
      crsHitRate: baseStats?.crsHitRate ?? {},
      coordMissing: baseStats?.noCoord ?? 0,
      joinMatchRate: 0.92,
      joinNote: 'analyze-join.ts 실측 (6,542/7,113, 법정동+번+지 기준). 실패 8%는 상가정보 커버리지 밖 업종',
      crsMedianError: 'EPSG:5174 가정 시 중앙값 2.1m vs EPSG:2097 가정 시 254.9m (상호 일치 4,285쌍)',
      relicenseSuspectPct: 0.056,
      relicenseNote: 'check-relicense.ts 실측 (최근 13개월 39/699). 폐업↔신규 재인허가 패턴',
    },
    analysis: {
      survivalSample: survival?.sample ?? null,
      industryGapPct,
      industryRange,
      maskedBelowSample: masked,
      minSample: 30,
    },
    quality: {
      jestSuites: 7,
      jestCases: 66,
      jestPassing: true,
      ci: 'GitHub Actions: tsc --noEmit + Jest + docker build (main push/PR마다)',
      dockerVerified: true,
      note: '생존·좌표 로직은 파이프라인과 공유 모듈을 테스트(복사본 아님). Docker 산출물 로컬과 ID 집합 차이 0.',
    },
  };
}
