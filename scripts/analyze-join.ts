/**
 * 조인 전략 분석 (용산구 기준).
 *
 * 목적:
 * 1) 인허가(지번주소 문자열) ↔ 상가정보(법정동코드+번+지, WGS84 좌표) 주소 조인 매칭률 실측
 * 2) 매칭 쌍의 좌표 거리로 인허가 좌표계(EPSG:5174 vs 2097) 정밀 판정 — bbox로는 변별 불가했음
 * 3) 건축물대장 표제부 조인 키(법정동코드+대지구분+번+지) 설계 검증:
 *    상가정보의 지번코드 19자리 = 법정동10 + 대지구분1 + 번4 + 지4 → 건축HUB API 파라미터와 동일 구조
 *
 * 실행: npx tsx scripts/analyze-join.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import proj4 from 'proj4';
import { parse } from 'csv-parse';
import type { Place } from '../src/types';

const SIGUNGU = '11170';
const PREFIX = '서울특별시 용산구';
const RAW = path.join(process.cwd(), 'data', 'raw');
const SBIZ_FILE = path.join(RAW, '소상공인시장진흥공단_상가(상권)정보_서울_202606.csv');

const PROJ_5174 =
  '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43';
const PROJ_2097 =
  '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43';

/** "서울특별시 용산구 이태원동 34-87 지하1층" → { dong: '이태원동', bun: 34, ji: 87 } */
function parseJibun(jibun: string): { dong: string; bun: number; ji: number } | null {
  const rest = jibun.replace(PREFIX, '').trim();
  const m = rest.match(/^(\S+)\s+(?:산\s*)?(\d+)(?:-(\d+))?/);
  if (!m) return null;
  return { dong: m[1], bun: Number(m[2]), ji: Number(m[3] ?? 0) };
}

function haversine(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const normName = (s: string) => s.replace(/[\s()\-·.,']/g, '').toLowerCase();

interface SbizRow {
  name: string;
  jibunAddress: string;
  roadAddress: string;
  bjdongCode: string;
  bjdongName: string;
  bun: number;
  ji: number;
  jibunCode: string;
  lng: number;
  lat: number;
}

async function loadSbiz(): Promise<SbizRow[]> {
  const rows: SbizRow[] = [];
  await new Promise<void>((resolve, reject) => {
    const parser = parse({ columns: true, bom: true, relax_quotes: true, skip_records_with_error: true });
    fs.createReadStream(SBIZ_FILE)
      .pipe(parser)
      .on('data', (r: Record<string, string>) => {
        if (r['시군구코드'] !== SIGUNGU) return;
        rows.push({
          name: r['상호명'],
          jibunAddress: r['지번주소'],
          roadAddress: r['도로명주소'],
          bjdongCode: r['법정동코드'],
          bjdongName: r['법정동명'],
          bun: Number(r['지번본번지'] || 0),
          ji: Number(r['지번부번지'] || 0),
          jibunCode: r['지번코드'],
          lng: parseFloat(r['경도']),
          lat: parseFloat(r['위도']),
        });
      })
      .on('end', resolve)
      .on('error', reject);
  });
  return rows;
}

async function main() {
  const places = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'regions', SIGUNGU, 'places.json'), 'utf-8'),
  ) as Place[];
  const sbiz = await loadSbiz();
  console.log(`인허가(영업중) ${places.length}건, 상가정보 ${sbiz.length}건\n`);

  // === 1. 주소 필드 샘플 5건씩 나란히 ===
  console.log('=== 인허가 주소 샘플 5건 ===');
  for (const p of places.slice(0, 5)) console.log(`  지번: ${p.jibunAddress}\n  도로명: ${p.address}\n  --`);
  console.log('=== 상가정보 주소 샘플 5건 ===');
  for (const s of sbiz.slice(0, 5))
    console.log(`  지번: ${s.jibunAddress}\n  도로명: ${s.roadAddress}\n  법정동코드: ${s.bjdongCode} 번:${s.bun} 지:${s.ji} 지번코드:${s.jibunCode}\n  --`);

  // === 2. 지번 파싱 성공률 (인허가) ===
  let parsed = 0;
  const parseFail: string[] = [];
  for (const p of places) {
    if (p.jibunAddress && parseJibun(p.jibunAddress)) parsed += 1;
    else if (parseFail.length < 5) parseFail.push(p.jibunAddress ?? '(지번 없음)');
  }
  console.log(`\n인허가 지번 파싱 성공: ${parsed}/${places.length} (${((parsed / places.length) * 100).toFixed(1)}%)`);
  if (parseFail.length) console.log('파싱 실패 표본:', parseFail);

  // === 3. (동, 번, 지) 키 조인: 인허가 → 상가정보 ===
  const sbizByKey = new Map<string, SbizRow[]>();
  for (const s of sbiz) {
    const key = `${s.bjdongName}|${s.bun}|${s.ji}`;
    if (!sbizByKey.has(key)) sbizByKey.set(key, []);
    sbizByKey.get(key)!.push(s);
  }
  let addrMatched = 0;
  let nameMatched = 0;
  const pairDist: { d5174: number; d2097: number }[] = [];
  const failSamples: string[] = [];
  for (const p of places) {
    const j = p.jibunAddress ? parseJibun(p.jibunAddress) : null;
    if (!j) continue;
    const candidates = sbizByKey.get(`${j.dong}|${j.bun}|${j.ji}`);
    if (!candidates) {
      if (failSamples.length < 5) failSamples.push(`${p.name} @ ${p.jibunAddress}`);
      continue;
    }
    addrMatched += 1;
    const nameHit = candidates.find((c) => normName(c.name) === normName(p.name) || normName(c.name).includes(normName(p.name)) || normName(p.name).includes(normName(c.name)));
    if (nameHit && Number.isFinite(nameHit.lng)) {
      nameMatched += 1;
      // places.json의 lat/lng는 5174로 변환된 값. 2097 재변환을 위해 역변환 → 재변환
      const [x, y] = proj4(proj4.WGS84, PROJ_5174, [p.lng, p.lat]);
      const [lng2097, lat2097] = proj4(PROJ_2097, proj4.WGS84, [x, y]);
      pairDist.push({
        d5174: haversine(p.lng, p.lat, nameHit.lng, nameHit.lat),
        d2097: haversine(lng2097, lat2097, nameHit.lng, nameHit.lat),
      });
    }
  }
  const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(1)}%`;
  console.log(`\n(동,번,지) 주소 조인: ${addrMatched}/${places.length} (${pct(addrMatched, places.length)})`);
  console.log(`  + 상호명까지 일치(좌표 비교 가능 쌍): ${nameMatched}건`);
  if (failSamples.length) console.log('주소 조인 실패 표본:', failSamples);

  // === 4. 좌표계 정밀 판정 ===
  const median = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  if (pairDist.length > 10) {
    const m5174 = median(pairDist.map((p) => p.d5174));
    const m2097 = median(pairDist.map((p) => p.d2097));
    console.log(`\n좌표계 판정 (상호명 일치 ${pairDist.length}쌍, 상가정보 WGS84 대비 중앙값 거리):`);
    console.log(`  EPSG:5174 가정: ${m5174.toFixed(1)}m / EPSG:2097 가정: ${m2097.toFixed(1)}m`);
    console.log(`  → ${m5174 <= m2097 ? 'EPSG:5174' : 'EPSG:2097'}이 실제 좌표계로 판정`);
  }

  // === 5. 법정동코드 맵 검증: 파싱한 동 이름이 상가정보 법정동명에 존재하는가 ===
  const bjdongNames = new Set(sbiz.map((s) => s.bjdongName));
  const dongCount = new Map<string, number>();
  for (const p of places) {
    const j = p.jibunAddress ? parseJibun(p.jibunAddress) : null;
    if (j) dongCount.set(j.dong, (dongCount.get(j.dong) ?? 0) + 1);
  }
  const unknownDongs = [...dongCount.entries()].filter(([d]) => !bjdongNames.has(d));
  console.log(`\n인허가 동 이름 ${dongCount.size}종 중 법정동 맵에 없는 것: ${unknownDongs.length}종`, unknownDongs.slice(0, 10));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
