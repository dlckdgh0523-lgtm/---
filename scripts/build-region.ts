/**
 * 지역 데이터 팩 생성 — 시군구코드 하나를 받아 멱등하게 처리한다.
 *
 *   npm run build:region -- --sigungu=11170
 *
 * 산출물:
 *   public/data/regions/{code}/places.json   인허가 기반 사업장 (영업중, 좌표 변환 완료)
 *   public/data/regions/{code}/bjdong.json   법정동코드 맵 (상가정보에서 추출 — 건축HUB API·조인용)
 *   public/data/regions/{code}/meta.json     생성 메타 (레코드 수, 데이터셋 기준일, 경과 구간 분포)
 *   public/data/regions/index.json           레지스트리 upsert (단일 출처)
 *
 * 설계 원칙:
 * - 스트리밍만. CSV 전체를 메모리·컨텍스트에 올리지 않는다.
 * - 인허가 CSV는 CP949 → iconv-lite 변환.
 * - 좌표는 EPSG:5174 가정 → 검증 후 EPSG:2097과 비교, 한국 bbox 적중률 높은 쪽 채택·로그.
 * - 멱등: 같은 인자로 다시 돌리면 같은 위치에 덮어쓰고 레지스트리를 upsert.
 * - 스케줄러가 "하루 한 지역씩 이 스크립트를 호출"하는 것만으로 자동화 가능해야 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';
import proj4 from 'proj4';
import { parse } from 'csv-parse';
import { stageFor } from '../src/config/elapsed-stages';
import type { Place } from '../src/types';

const RAW = path.join(process.cwd(), 'data', 'raw');
const OUT_ROOT = path.join(process.cwd(), 'public', 'data', 'regions');

// 좌표계 정의는 src/lib/geo.ts 단일 출처 (Jest 테스트와 공유 — 2026-08-14)
import { KOREA_BBOX, PROJ_2097, PROJ_5174 } from '../src/lib/geo';

interface RegionsGenerated {
  sido: { code: string; name: string; sigungu: { code: string; name: string }[] }[];
}

function loadRegionInfo(sigunguCode: string) {
  const generated = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'src', 'data', 'regions.generated.json'), 'utf-8'),
  ) as RegionsGenerated;
  for (const sido of generated.sido) {
    const sigungu = sido.sigungu.find((s) => s.code === sigunguCode);
    if (sigungu) return { sidoName: sido.name, sigunguName: sigungu.name };
  }
  throw new Error(`시군구코드 ${sigunguCode}가 regions.generated.json에 없습니다. extract-regions.ts를 먼저 실행하세요.`);
}

function inKorea(lng: number, lat: number): boolean {
  return lng >= KOREA_BBOX.minLng && lng <= KOREA_BBOX.maxLng && lat >= KOREA_BBOX.minLat && lat <= KOREA_BBOX.maxLat;
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  const t = raw.trim().replace(/[./]/g, '-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  return null;
}

function elapsedMonths(licenseDate: string, now: Date): number {
  const [y, m] = licenseDate.split('-').map(Number);
  return Math.max(0, (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m));
}

/** 지번주소에서 동 이름 추출: "서울특별시 용산구 이태원동 34-87 ..." → "이태원동" */
function parseDong(jibun: string | null, prefix: string): string | null {
  if (!jibun) return null;
  const rest = jibun.replace(prefix, '').trim();
  const token = rest.split(/\s+/)[0];
  return token && /(동|가|로|리)\d*$/.test(token) ? token : token || null;
}

/** 재인허가 의심 판정용 (동|번|지) 키 */
function jibunKey(jibun: string, prefix: string): string | null {
  const m = jibun.replace(prefix, '').trim().match(/^(\S+)\s+(?:산\s*)?(\d+)(?:-(\d+))?/);
  return m ? `${m[1]}|${Number(m[2])}|${Number(m[3] ?? 0)}` : null;
}

const normName = (s: string) => (s || '').replace(/[\s()\-·.,'&]/g, '').toLowerCase();

/** 인허가 CSV 한 파일을 스트리밍 처리 */
async function scanLicenseFile(opts: {
  file: string;
  prefix: string;
  category: string;
  stats: Stats;
  closures: Map<string, { name: string; closedAt: string; category: string }[]>;
  onRow: (p: Omit<Place, 'lat' | 'lng' | 'coordConverted'> & { x: number | null; y: number | null }) => void;
}) {
  const { file, prefix, category, stats, closures, onRow } = opts;
  return new Promise<void>((resolve, reject) => {
    const parser = parse({ columns: true, relax_quotes: true, relax_column_count: true, skip_records_with_error: true });
    fs.createReadStream(file)
      .pipe(iconv.decodeStream('cp949'))
      .pipe(parser)
      .on('data', (row: Record<string, string>) => {
        stats.scanned += 1;
        const road = (row['도로명주소'] ?? '').trim();
        const jibun = (row['지번주소'] ?? '').trim();
        if (!road.startsWith(prefix) && !jibun.startsWith(prefix)) return;
        stats.inRegion += 1;
        const statusCode = (row['영업상태코드'] ?? '').trim();
        stats.statusCounts[row['영업상태명']?.trim() || '?'] = (stats.statusCounts[row['영업상태명']?.trim() || '?'] ?? 0) + 1;
        if (statusCode !== '01') {
          // 폐업 레코드는 재인허가 의심 판정 재료로 수집
          if ((row['영업상태명'] ?? '').trim() === '폐업' && jibun) {
            const closedAt = (row['폐업일자'] ?? '').trim().replace(/[./]/g, '-');
            const key = jibunKey(jibun, prefix);
            if (key && closedAt) {
              if (!closures.has(key)) closures.set(key, []);
              closures.get(key)!.push({ name: (row['사업장명'] ?? '').trim(), closedAt, category });
            }
          }
          return;
        }
        stats.open += 1;
        const licenseDate = normalizeDate(row['인허가일자'] ?? '');
        if (!licenseDate) {
          stats.noDate += 1;
          return;
        }
        const xRaw = parseFloat((row['좌표정보(X)'] ?? '').trim());
        const yRaw = parseFloat((row['좌표정보(Y)'] ?? '').trim());
        onRow({
          id: (row['관리번호'] ?? '').trim() || `${category}-${stats.inRegion}`,
          name: (row['사업장명'] ?? '').trim(),
          category: { large: category, medium: (row['업태구분명'] ?? '').trim(), small: (row['위생업태명'] ?? '').trim() },
          address: road || jibun,
          jibunAddress: jibun || null,
          adminDong: parseDong(jibun || null, prefix),
          licenseDate,
          source: 'localdata',
          x: Number.isFinite(xRaw) ? xRaw : null,
          y: Number.isFinite(yRaw) ? yRaw : null,
        });
      })
      .on('end', resolve)
      .on('error', reject);
  });
}

interface Stats {
  scanned: number;
  inRegion: number;
  open: number;
  noDate: number;
  noCoord: number;
  outOfBbox: number;
  statusCounts: Record<string, number>;
}

/** 상가정보에서 해당 시군구의 법정동코드 맵 + 레코드 수 추출 */
async function scanSbiz(sidoName: string, sigunguCode: string) {
  // 파일명 토큰 매칭: 시도명 앞 2글자 (서울특별시→서울, 전남광주통합특별시→전남광주 파일에 '전남' 포함)
  const token2 = sidoName.slice(0, 2);
  const candidates = fs.readdirSync(RAW).filter((f) => f.includes('상가(상권)정보') && f.endsWith('.csv'));
  const matched = candidates.find((f) => f.includes(token2));
  if (!matched) return { bjdong: {}, sbizCount: 0, sbizFile: null as string | null };

  const bjdong: Record<string, string> = {};
  let sbizCount = 0;
  await new Promise<void>((resolve, reject) => {
    const parser = parse({ columns: true, bom: true, relax_quotes: true, skip_records_with_error: true });
    fs.createReadStream(path.join(RAW, matched))
      .pipe(parser)
      .on('data', (row: Record<string, string>) => {
        if (row['시군구코드'] !== sigunguCode) return;
        sbizCount += 1;
        const code = row['법정동코드'];
        if (code && /^\d{10}$/.test(code) && !bjdong[code]) bjdong[code] = row['법정동명'];
      })
      .on('end', resolve)
      .on('error', reject);
  });
  return { bjdong, sbizCount, sbizFile: matched };
}

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--sigungu='));
  if (!arg) throw new Error('사용법: npm run build:region -- --sigungu=11170');
  const sigunguCode = arg.split('=')[1];
  const { sidoName, sigunguName } = loadRegionInfo(sigunguCode);
  const prefix = `${sidoName} ${sigunguName}`;
  console.log(`대상 지역: ${prefix} (${sigunguCode})`);

  // 인허가 파일: {분류}_{업종}_{시도명}.csv — 해당 시도 파일만
  const licenseFiles = fs
    .readdirSync(RAW)
    .filter((f) => f.endsWith('.csv') && !f.includes('상가(상권)정보') && f.replace('.csv', '').endsWith(sidoName));
  if (licenseFiles.length === 0) {
    throw new Error(`${sidoName}의 인허가 CSV가 data/raw에 없습니다. 팩을 만들지 않습니다(빈 팩 생성 금지).`);
  }
  console.log(`인허가 파일 ${licenseFiles.length}개: ${licenseFiles.map((f) => f.split('_')[1]).join(', ')}`);

  const stats: Stats = { scanned: 0, inRegion: 0, open: 0, noDate: 0, noCoord: 0, outOfBbox: 0, statusCounts: {} };
  const rawRows: (Omit<Place, 'lat' | 'lng' | 'coordConverted'> & { x: number | null; y: number | null })[] = [];
  const closures = new Map<string, { name: string; closedAt: string; category: string }[]>();
  for (const f of licenseFiles) {
    const category = f.replace('.csv', '').split('_')[1] ?? f;
    await scanLicenseFile({ file: path.join(RAW, f), prefix, category, stats, closures, onRow: (r) => rawRows.push(r) });
    console.log(`  ${f}: 누적 지역 내 ${stats.inRegion}건 / 영업중 ${stats.open}건`);
  }

  // 재인허가(양수도·업종 전환) 의심 플래그 — 같은 (동,번,지)+유사 상호가 인허가 직전(-30~180일) 폐업
  let relicenseCount = 0;
  for (const r of rawRows) {
    if (!r.jibunAddress) continue;
    const key = jibunKey(r.jibunAddress, prefix);
    if (!key) continue;
    const lic = new Date(r.licenseDate).getTime();
    const hit = (closures.get(key) ?? []).find((c) => {
      const closed = new Date(c.closedAt).getTime();
      if (Number.isNaN(closed)) return false;
      const gapDays = (lic - closed) / 86400000;
      if (gapDays < -30 || gapDays > 180) return false;
      const a = normName(r.name);
      const b = normName(c.name);
      return !!a && !!b && (a === b || a.includes(b) || b.includes(a));
    });
    if (hit) {
      r.suspectedRelicense = { prevName: hit.name, prevClosedAt: hit.closedAt, prevCategory: hit.category };
      relicenseCount += 1;
    }
  }
  console.log(`재인허가(업종 전환 포함) 의심: ${relicenseCount}건`);

  // 좌표계 판정: 표본으로 5174 vs 2097 적중률 비교
  const sample = rawRows.filter((r) => r.x != null && r.y != null).slice(0, 500);
  const hit = (def: string) =>
    sample.filter((r) => {
      const [lng, lat] = proj4(def, proj4.WGS84, [r.x as number, r.y as number]);
      return inKorea(lng, lat);
    }).length;
  const hit5174 = hit(PROJ_5174);
  const hit2097 = hit(PROJ_2097);
  const chosen = hit5174 >= hit2097 ? PROJ_5174 : PROJ_2097;
  const chosenName = hit5174 >= hit2097 ? 'EPSG:5174' : 'EPSG:2097';
  console.log(`좌표계 판정: 5174 적중 ${hit5174}/${sample.length}, 2097 적중 ${hit2097}/${sample.length} → ${chosenName} 채택`);

  const now = new Date();
  const places: Place[] = [];
  for (const r of rawRows) {
    if (r.x == null || r.y == null) {
      stats.noCoord += 1;
      continue;
    }
    const [lng, lat] = proj4(chosen, proj4.WGS84, [r.x, r.y]);
    if (!inKorea(lng, lat)) {
      stats.outOfBbox += 1;
      continue;
    }
    const { x: _x, y: _y, ...rest } = r;
    places.push({ ...rest, lat: Math.round(lat * 1e7) / 1e7, lng: Math.round(lng * 1e7) / 1e7, coordConverted: true });
  }

  // 경과 구간 분포 (보고용 — places.json에는 파생값을 굽지 않는다)
  const distribution: Record<string, number> = {};
  for (const p of places) {
    const rule = stageFor(elapsedMonths(p.licenseDate, now));
    distribution[`${rule.label}(${rule.minMonth}~${rule.maxMonth ?? ''}개월)`] =
      (distribution[`${rule.label}(${rule.minMonth}~${rule.maxMonth ?? ''}개월)`] ?? 0) + 1;
  }

  // 상가정보 → 법정동 맵 + 지역 내 상가 수
  console.log('상가정보 스캔 중 (법정동코드 맵)...');
  const { bjdong, sbizCount, sbizFile } = await scanSbiz(sidoName, sigunguCode);

  // 산출물 쓰기 (멱등 덮어쓰기)
  const outDir = path.join(OUT_ROOT, sigunguCode);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'places.json'), JSON.stringify(places));
  fs.writeFileSync(path.join(outDir, 'bjdong.json'), JSON.stringify({ sigunguCode, bjdong }, null, 2));
  const meta = {
    sigunguCode,
    name: prefix,
    generatedAt: now.toISOString(),
    recordCount: places.length,
    datasets: [
      ...licenseFiles.map((f) => ({ file: f, kind: 'localdata-license', encoding: 'cp949', crs: chosenName })),
      ...(sbizFile ? [{ file: sbizFile, kind: 'sbiz-storefront', encoding: 'utf-8', 기준연월: '2026-06' }] : []),
    ],
    stats: { ...stats, sbizCountInRegion: sbizCount, coordCrs: chosenName, crsHitRate: { 'EPSG:5174': `${hit5174}/${sample.length}`, 'EPSG:2097': `${hit2097}/${sample.length}` } },
    distribution,
  };
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));

  // 레지스트리 upsert
  const indexPath = path.join(OUT_ROOT, 'index.json');
  const registry = fs.existsSync(indexPath)
    ? (JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as { updatedAt: string; regions: { code: string; name: string; builtAt: string; recordCount: number }[] })
    : { updatedAt: '', regions: [] };
  registry.regions = registry.regions.filter((r) => r.code !== sigunguCode);
  registry.regions.push({ code: sigunguCode, name: prefix, builtAt: now.toISOString(), recordCount: places.length });
  registry.regions.sort((a, b) => a.code.localeCompare(b.code));
  registry.updatedAt = now.toISOString();
  fs.writeFileSync(indexPath, JSON.stringify(registry, null, 2));

  console.log('\n=== 완료 ===');
  console.log(`스캔 ${stats.scanned.toLocaleString()}행 → 지역 내 ${stats.inRegion.toLocaleString()} → 영업중 ${stats.open.toLocaleString()}`);
  console.log(`제외: 인허가일 없음 ${stats.noDate}, 좌표 없음 ${stats.noCoord}, 좌표 이상 ${stats.outOfBbox}`);
  console.log(`영업상태 분포:`, stats.statusCounts);
  console.log(`최종 places: ${places.length.toLocaleString()}건, 법정동 ${Object.keys(bjdong).length}개, 상가정보 지역 내 ${sbizCount.toLocaleString()}건`);
  console.log(`경과 구간 분포:`, distribution);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
