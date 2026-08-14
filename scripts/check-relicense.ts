/**
 * 재인허가(양수도·업종전환) 의심 플래그 실측.
 * 규칙: 최근 13개월 신규 인허가 사업장과 "같은 (동,번,지) + 유사 상호"의 폐업 레코드가 있고
 *       그 폐업일이 신규 인허가일 기준 [-180일, +30일] 안이면 → 재인허가 의심 (연속 운영 가게).
 * 검증된 사례: 달볶이 — 2001 인허가 일반음식점 폐업(2025-07-29) → 2025-08-14 휴게음식점 신규.
 */
import fs from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse';
import type { Place } from '../src/types';

const RAW = path.join(process.cwd(), 'data', 'raw');
const PREFIX = '서울특별시 용산구';
const norm = (s: string) => (s || '').replace(/[\s()\-·.,'&]/g, '').toLowerCase();

function jibunKey(jibun: string): string | null {
  const m = jibun.replace(PREFIX, '').trim().match(/^(\S+)\s+(?:산\s*)?(\d+)(?:-(\d+))?/);
  return m ? `${m[1]}|${Number(m[2])}|${Number(m[3] ?? 0)}` : null;
}

async function main() {
  const files = fs.readdirSync(RAW).filter((f) => f.endsWith('.csv') && !f.includes('상가(상권)정보') && f.replace('.csv', '').endsWith('서울특별시'));
  // 1) 용산 폐업 레코드 수집: key → [{name, closedAt}]
  const closures = new Map<string, { name: string; closedAt: string }[]>();
  for (const f of files) {
    await new Promise<void>((resolve, reject) => {
      const parser = parse({ columns: true, relax_quotes: true, relax_column_count: true, skip_records_with_error: true });
      fs.createReadStream(path.join(RAW, f))
        .pipe(iconv.decodeStream('cp949'))
        .pipe(parser)
        .on('data', (row: Record<string, string>) => {
          const jibun = (row['지번주소'] ?? '').trim();
          if (!jibun.startsWith(PREFIX)) return;
          if ((row['영업상태명'] ?? '').trim() !== '폐업') return;
          const closedAt = (row['폐업일자'] ?? '').trim().replace(/[./]/g, '-');
          const key = jibunKey(jibun);
          if (!key || !closedAt) return;
          if (!closures.has(key)) closures.set(key, []);
          closures.get(key)!.push({ name: (row['사업장명'] ?? '').trim(), closedAt });
        })
        .on('end', resolve)
        .on('error', reject);
    });
  }

  // 2) 최근 13개월 신규와 대조
  const places = JSON.parse(fs.readFileSync('public/data/regions/11170/places.json', 'utf-8')) as Place[];
  const now = new Date('2026-08-13');
  const em = (d: string) => { const [y, m] = d.split('-').map(Number); return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m); };
  const recent = places.filter((p) => em(p.licenseDate) <= 13 && p.jibunAddress);

  let flagged = 0;
  const samples: string[] = [];
  for (const p of recent) {
    const key = jibunKey(p.jibunAddress!);
    if (!key) continue;
    const cands = closures.get(key) ?? [];
    const lic = new Date(p.licenseDate).getTime();
    const hit = cands.find((c) => {
      const closed = new Date(c.closedAt).getTime();
      if (Number.isNaN(closed)) return false;
      const gapDays = (lic - closed) / 86400000;
      if (gapDays < -30 || gapDays > 180) return false;
      const a = norm(p.name), b = norm(c.name);
      return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
    });
    if (hit) {
      flagged += 1;
      if (samples.length < 10) samples.push(`${p.name} | 인허가 ${p.licenseDate} ← 동일자리·유사상호 폐업 ${hit.closedAt} (${hit.name})`);
    }
  }
  console.log(`최근 13개월 신규 ${recent.length}건 중 재인허가 의심(동일 자리+유사 상호 직전 폐업): ${flagged}건 (${((flagged / recent.length) * 100).toFixed(1)}%)`);
  console.log('표본:', samples);
}
main().catch((e) => { console.error(e); process.exit(1); });
