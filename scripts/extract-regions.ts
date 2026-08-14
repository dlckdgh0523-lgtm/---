/**
 * 전국 시도/시군구 목록 추출 — 소상공인 상가(상권)정보 CSV 16개 파일에서.
 *
 * 왜 이렇게 하나: 행정구역 목록·코드를 추측으로 채우는 것은 금지 사항이다.
 * 상가정보는 행 단위로 시도코드/시도명/시군구코드/시군구명을 담고 있어(공단 원천),
 * 데이터에서 추출하면 지어낼 필요가 없다.
 *
 * 실행: npx tsx scripts/extract-regions.ts
 * 출력: src/data/regions.generated.json
 *
 * 대용량 원칙: 스트리밍 파싱만. 파일을 통째로 메모리에 올리지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse';

const RAW_DIR = path.join(process.cwd(), 'data', 'raw');
const OUT = path.join(process.cwd(), 'src', 'data', 'regions.generated.json');

interface Sigungu {
  code: string;
  name: string;
}
interface Sido {
  code: string;
  name: string;
  sigungu: Sigungu[];
}

async function scanFile(file: string, sidoMap: Map<string, { name: string; sigungu: Map<string, string> }>) {
  return new Promise<number>((resolve, reject) => {
    let rows = 0;
    const parser = parse({ columns: true, bom: true, relax_quotes: true, skip_records_with_error: true });
    fs.createReadStream(file)
      .pipe(parser)
      .on('data', (row: Record<string, string>) => {
        rows += 1;
        const sidoCode = row['시도코드'];
        const sigunguCode = row['시군구코드'];
        if (!sidoCode || !sigunguCode) return;
        if (!/^\d{2}$/.test(sidoCode) || !/^\d{5}$/.test(sigunguCode)) return;
        let sido = sidoMap.get(sidoCode);
        if (!sido) {
          sido = { name: row['시도명'], sigungu: new Map() };
          sidoMap.set(sidoCode, sido);
        }
        if (!sido.sigungu.has(sigunguCode)) sido.sigungu.set(sigunguCode, row['시군구명']);
      })
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function main() {
  const files = fs
    .readdirSync(RAW_DIR)
    .filter((f) => f.includes('상가(상권)정보') && f.endsWith('.csv'))
    .map((f) => path.join(RAW_DIR, f));
  if (files.length === 0) throw new Error(`상가정보 CSV가 ${RAW_DIR}에 없습니다`);

  const sidoMap = new Map<string, { name: string; sigungu: Map<string, string> }>();
  let total = 0;
  for (const file of files) {
    const rows = await scanFile(file, sidoMap);
    total += rows;
    console.log(`${path.basename(file)}: ${rows.toLocaleString()}행`);
  }

  const result: Sido[] = [...sidoMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, s]) => ({
      code,
      name: s.name,
      sigungu: [...s.sigungu.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([c, n]) => ({ code: c, name: n })),
    }));

  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), source: '소상공인시장진흥공단 상가(상권)정보 202606', sido: result }, null, 2));
  const sigunguCount = result.reduce((s, x) => s + x.sigungu.length, 0);
  console.log(`\n총 ${total.toLocaleString()}행 스캔 → 시도 ${result.length}개, 시군구 ${sigunguCount}개 → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
