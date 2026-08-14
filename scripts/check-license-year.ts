/**
 * 인허가일자 신뢰도 내부 검증 프록시:
 * 관리번호 형식 "3020000-101-YYYY-NNNNN"의 연도 = 최초 부여 시점 연도로 추정.
 * 인허가일자 연도가 관리번호 연도와 다르면 → 인허가일이 나중에 갱신된 레코드(양수도·재인허가 등) 신호.
 */
import fs from 'node:fs';
import type { Place } from '../src/types';
const places = JSON.parse(fs.readFileSync('public/data/regions/11170/places.json', 'utf-8')) as Place[];
const now = new Date('2026-08-13');
const em = (d: string) => { const [y, m] = d.split('-').map(Number); return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m); };

let parsable = 0, mismatch = 0;
let recentTotal = 0, recentMismatch = 0;
const mismatchSamples: string[] = [];
for (const p of places) {
  const m = p.id.match(/^\d+-\d+-(\d{4})-\d+/);
  if (!m) continue;
  parsable++;
  const mgmtYear = Number(m[1]);
  const licYear = Number(p.licenseDate.slice(0, 4));
  const isRecent = em(p.licenseDate) <= 13;
  if (isRecent) recentTotal++;
  if (mgmtYear !== licYear) {
    mismatch++;
    if (isRecent) {
      recentMismatch++;
      if (mismatchSamples.length < 8) mismatchSamples.push(`${p.name} | 관리번호연도 ${mgmtYear} vs 인허가일 ${p.licenseDate}`);
    }
  }
}
console.log(`관리번호 연도 파싱 가능: ${parsable}/${places.length}`);
console.log(`전체 불일치(관리번호연도 ≠ 인허가연도): ${mismatch} (${((mismatch / parsable) * 100).toFixed(1)}%)`);
console.log(`최근 13개월 인허가 ${recentTotal}건 중 불일치: ${recentMismatch} (${recentTotal ? ((recentMismatch / recentTotal) * 100).toFixed(1) : 0}%)`);
console.log('최근 구간 불일치 표본:', mismatchSamples);
