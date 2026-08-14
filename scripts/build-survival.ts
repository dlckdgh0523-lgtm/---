/**
 * 생존 분석 — 용산구 전체(폐업 포함) 인허가 레코드로 존속 곡선을 추정한다.
 *
 * 목적 (분석 전에 판정 기준 고정 — 사후 합리화 방지):
 *   "우선 접촉(개업 3~6개월) 구간에서 딴 계약이 유지 기간을 채울 수 있는가"
 *   핵심 지표 = 나이 m개월 사업장이 추가로 24개월 생존할 조건부 확률 S(m+24)/S(m).
 *   m=6의 값이 m=24, m=36과 비교해 크게 낮으면 가설은 반증된다.
 *
 * 방법: 우측 중도절단(right censoring)을 반영한 Kaplan-Meier 이산(월 단위) 추정.
 *   - 폐업 레코드: 인허가일 → 폐업일 = 사건(event)
 *   - 영업 레코드: 인허가일 → 기준일(오늘) = 중도절단(censored)
 * 한계(명시): 1960~2026년 코호트를 합산하므로 시대별 폐업 패턴 차이가 섞인다.
 *   → 2015년 이후 인허가 코호트로 제한한 곡선을 병행 산출해 강건성을 확인한다.
 *
 * 실행: npx tsx scripts/build-survival.ts
 * 산출: public/data/regions/11170/survival.json
 */
import fs from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse';
import { bucketHazard as bucketHazardShared, conditionalSurvival, kaplanMeier as kaplanMeierShared } from '../src/lib/survival-math';

const RAW = path.join(process.cwd(), 'data', 'raw');
const PREFIX = '서울특별시 용산구';
const SIGUNGU = '11170';
const NOW = new Date('2026-08-13');
const MAX_MONTH = 120; // 10년 이후는 합산

interface Rec {
  category: string;
  licenseMonths: number; // 존속 개월 (사건 or 절단 시점)
  closed: boolean;
  licenseDate: string;
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function parseDate(raw: string): Date | null {
  const t = (raw ?? '').trim().replace(/[./]/g, '-');
  const m = t.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// KM·조건부 생존 수학은 src/lib/survival-math.ts 단일 구현을 쓴다 (Jest 테스트와 공유 — 2026-08-14)
const kaplanMeier = (recs: { t: number; event: boolean }[]) => kaplanMeierShared(recs, MAX_MONTH);
const bucketHazard = (surv: number[], start: number, end: number) => bucketHazardShared(surv, start, end, MAX_MONTH);

async function main() {
  const files = fs
    .readdirSync(RAW)
    .filter((f) => f.endsWith('.csv') && !f.includes('상가(상권)정보') && f.replace('.csv', '').endsWith('서울특별시'));

  const recs: Rec[] = [];
  let skippedBadDates = 0;
  let skippedNegative = 0;
  for (const f of files) {
    const category = f.replace('.csv', '').split('_')[1] ?? f;
    await new Promise<void>((resolve, reject) => {
      const parser = parse({ columns: true, relax_quotes: true, relax_column_count: true, skip_records_with_error: true });
      fs.createReadStream(path.join(RAW, f))
        .pipe(iconv.decodeStream('cp949'))
        .pipe(parser)
        .on('data', (row: Record<string, string>) => {
          const road = (row['도로명주소'] ?? '').trim();
          const jibun = (row['지번주소'] ?? '').trim();
          if (!road.startsWith(PREFIX) && !jibun.startsWith(PREFIX)) return;
          const status = (row['영업상태명'] ?? '').trim();
          if (status !== '폐업' && status !== '영업/정상') return; // 취소/말소 등 제외
          const lic = parseDate(row['인허가일자']);
          if (!lic) {
            skippedBadDates += 1;
            return;
          }
          if (status === '폐업') {
            const close = parseDate(row['폐업일자']);
            if (!close) {
              skippedBadDates += 1;
              return;
            }
            const t = monthsBetween(lic, close);
            if (t < 0) {
              skippedNegative += 1;
              return;
            }
            recs.push({ category, licenseMonths: t, closed: true, licenseDate: row['인허가일자'].trim() });
          } else {
            const t = monthsBetween(lic, NOW);
            if (t < 0) return;
            recs.push({ category, licenseMonths: t, closed: false, licenseDate: row['인허가일자'].trim() });
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });
  }
  console.log(`표본 ${recs.length}건 (폐업 ${recs.filter((r) => r.closed).length} / 영업 ${recs.filter((r) => !r.closed).length}), 제외: 날짜불량 ${skippedBadDates}, 음수존속 ${skippedNegative}`);

  const toKm = (rs: Rec[]) => kaplanMeier(rs.map((r) => ({ t: r.licenseMonths, event: r.closed })));

  const overall = toKm(recs);
  const recent = toKm(recs.filter((r) => r.licenseDate >= '2015-01-01'));

  // 골프장·골프연습장은 표본이 작아 병합
  const catName = (c: string) => (c.startsWith('골프') ? '골프시설' : c);
  const byCategory: Record<string, { n: number; closed: number; surv: number[] }> = {};
  for (const c of new Set(recs.map((r) => catName(r.category)))) {
    const rs = recs.filter((r) => catName(r.category) === c);
    byCategory[c] = { n: rs.length, closed: rs.filter((r) => r.closed).length, surv: toKm(rs) };
  }

  // 폐업 존속 개월 히스토그램 (사건만)
  const BUCKETS: [number, number, string][] = [
    [0, 2, '0~2개월'],
    [3, 6, '3~6개월'],
    [7, 12, '7~12개월'],
    [13, 24, '13~24개월'],
    [25, 36, '25~36개월'],
    [37, 60, '37~60개월'],
    [61, 120, '61개월~'],
  ];
  const closureHist = BUCKETS.map(([a, b, label]) => ({
    label,
    count: recs.filter((r) => r.closed && r.licenseMonths >= a && r.licenseMonths <= b).length,
  }));

  // 구간 조건부 폐업률 (전체·업종별)
  const hazardTable = BUCKETS.map(([a, b, label]) => ({
    label,
    start: a,
    end: b,
    overall: bucketHazard(overall, a, b),
    byCategory: Object.fromEntries(Object.entries(byCategory).map(([c, v]) => [c, bucketHazard(v.surv, a, b)])),
  }));

  // 핵심 판정 지표: 나이 m에서 +24개월 추가 생존 확률
  const AGES = [0, 3, 6, 12, 24, 36];
  const cond24 = AGES.map((m) => ({
    ageMonths: m,
    survivePlus24: overall[m] > 0 ? overall[Math.min(m + 24, MAX_MONTH)] / overall[m] : 0,
    recentCohort: recent[m] > 0 ? recent[Math.min(m + 24, MAX_MONTH)] / recent[m] : 0,
    byCategory: Object.fromEntries(
      Object.entries(byCategory).map(([c, v]) => [c, v.surv[m] > 0 ? v.surv[Math.min(m + 24, MAX_MONTH)] / v.surv[m] : 0]),
    ),
  }));

  // A. 나이 6개월 기준 +24개월 조건부 생존 — Greenwood CI + 위험집합 크기 (업종별 신뢰도 판정)
  const toDur = (rs: Rec[]) => rs.map((r) => ({ t: r.licenseMonths, event: r.closed }));
  const cond24at6 = {
    overall: conditionalSurvival(toDur(recs), 6, 24),
    recentCohort2015: conditionalSurvival(toDur(recs.filter((r) => r.licenseDate >= '2015-01-01')), 6, 24),
    byCategory: Object.fromEntries(
      Object.keys(byCategory).map((c) => [
        c,
        conditionalSurvival(toDur(recs.filter((r) => catName(r.category) === c)), 6, 24),
      ]),
    ),
  };

  // B. 계산기 연동용 업종 위험 상수 생성 — 코드에 수치를 하드코딩하지 않고 이 파일이 단일 출처
  const industryRisk = {
    generatedAt: NOW.toISOString(),
    sourceRegion: SIGUNGU,
    method: '조건부 KM (나이 6개월 → +24개월), Greenwood 95% CI. 표본(atRisk) 30 미만은 reliable=false — 점추정 사용 금지',
    avgClosure24: Math.round((1 - cond24at6.overall.survival) * 1000) / 1000,
    avgClosure24Recent2015: Math.round((1 - cond24at6.recentCohort2015.survival) * 1000) / 1000,
    industries: Object.fromEntries(
      Object.entries(cond24at6.byCategory).map(([c, v]) => [
        c,
        {
          closure24: Math.round((1 - v.survival) * 1000) / 1000,
          ciLow: Math.round((1 - v.ciHigh) * 1000) / 1000,
          ciHigh: Math.round((1 - v.ciLow) * 1000) / 1000,
          atRisk: v.atRisk,
          reliable: v.reliable,
        },
      ]),
    ),
  };
  fs.writeFileSync(path.join(process.cwd(), 'src', 'data', 'industry-risk.generated.json'), JSON.stringify(industryRisk, null, 2));

  // 개업 월 계절성 (최근 10년 인허가 기준)
  const seasonality = new Array(12).fill(0);
  for (const r of recs) {
    if (r.licenseDate >= '2016-01-01') {
      const mo = Number(r.licenseDate.slice(5, 7));
      if (mo >= 1 && mo <= 12) seasonality[mo - 1] += 1;
    }
  }

  const out = {
    sigunguCode: SIGUNGU,
    generatedAt: NOW.toISOString(),
    method: 'discrete-monthly Kaplan-Meier with right censoring',
    sample: { total: recs.length, closed: recs.filter((r) => r.closed).length, open: recs.filter((r) => !r.closed).length, skippedBadDates, skippedNegative },
    caveats: [
      '1960~2026년 코호트 합산 — 시대별 폐업 패턴 차이가 섞임 (recentCohort=2015년 이후 인허가로 강건성 확인)',
      '인허가일 ≈ 개업일 가정 (재인허가 의심 5.6% 실측, MEMORY.md)',
      '폐업일자 미기재 폐업 레코드는 제외',
    ],
    survival: { overall, recentCohort2015: recent },
    byCategory: Object.fromEntries(Object.entries(byCategory).map(([c, v]) => [c, { n: v.n, closed: v.closed, surv: v.surv }])),
    closureHist,
    hazardTable,
    cond24,
    cond24at6,
    seasonality,
  };
  const outPath = path.join(process.cwd(), 'public', 'data', 'regions', SIGUNGU, 'survival.json');
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log(`→ ${outPath}`);

  // 콘솔 판정 요약
  console.log('\n=== 생존율 S(m) (전체 / 2015+ 코호트) ===');
  for (const m of [3, 6, 12, 24, 36, 60, 120]) console.log(`  ${m}개월: ${(overall[m] * 100).toFixed(1)}% / ${(recent[m] * 100).toFixed(1)}%`);
  console.log('\n=== 구간 조건부 폐업률 (구간 시작 생존자 기준) ===');
  for (const h of hazardTable) console.log(`  ${h.label}: ${(h.overall * 100).toFixed(1)}%`);
  console.log('\n=== 핵심 판정: 나이 m → +24개월 추가 생존 확률 (전체 / 2015+) ===');
  for (const c of cond24) console.log(`  나이 ${c.ageMonths}개월: ${(c.survivePlus24 * 100).toFixed(1)}% / ${(c.recentCohort * 100).toFixed(1)}%`);
  console.log('\n=== 업종별 +24개월 생존 (나이 6개월 기준, Greenwood 95% CI, atRisk) ===');
  for (const [c, v] of Object.entries(cond24at6.byCategory)) {
    console.log(
      `  ${c}: ${(v.survival * 100).toFixed(1)}% [${(v.ciLow * 100).toFixed(1)}~${(v.ciHigh * 100).toFixed(1)}] atRisk=${v.atRisk}${v.reliable ? '' : ' ⚠️표본부족'}`,
    );
  }
  console.log(`\n전체 평균 24개월 폐업률: ${(industryRisk.avgClosure24 * 100).toFixed(1)}% (2015+ 코호트 ${(industryRisk.avgClosure24Recent2015 * 100).toFixed(1)}%)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
