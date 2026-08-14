/**
 * 건축HUB 건축물대장 표제부 테스트 호출 1건 — 응답 구조(실제 필드명) 확인용.
 * 키는 .env.local의 BUILDING_HUB_API_KEY. 출력에 키를 절대 포함하지 않는다.
 * 실행: npx tsx scripts/test-bldrgst.ts
 */
import fs from 'node:fs';
import path from 'node:path';

function loadKey(): string {
  const env = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8');
  const m = env.match(/^BUILDING_HUB_API_KEY=(.+)$/m);
  if (!m) throw new Error('.env.local에 BUILDING_HUB_API_KEY가 없습니다');
  return m[1].trim();
}

async function main() {
  const key = loadKey();
  // 실측 파라미터: 용산구 팩 첫 레코드 (후암동 103-10) — jibun.ts 파싱 결과와 동일 값
  const params = new URLSearchParams({
    sigunguCd: '11170',
    bjdongCd: '10100',
    platGbCd: '0',
    bun: '0103',
    ji: '0010',
    _type: 'json',
    numOfRows: '10',
    pageNo: '1',
  });
  // serviceKey는 인코딩 문제를 피하기 위해 직접 이어붙인다 (포털 안내: 인코딩/디코딩 키 주의)
  const url = `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${encodeURIComponent(key)}&${params}`;
  const res = await fetch(url);
  const text = await res.text();
  console.log('HTTP', res.status, res.headers.get('content-type'));
  try {
    const json = JSON.parse(text);
    const header = json?.response?.header;
    const body = json?.response?.body;
    console.log('resultCode/Msg:', header?.resultCode, header?.resultMsg);
    console.log('totalCount:', body?.totalCount);
    const items = body?.items?.item;
    const first = Array.isArray(items) ? items[0] : items;
    if (first) {
      console.log('\n=== 실제 필드명 전체 ===');
      console.log(Object.keys(first).join(', '));
      console.log('\n=== 관심 필드 값 ===');
      for (const k of ['bldNm', 'platPlc', 'newPlatPlc', 'strctCdNm', 'roofCdNm', 'archArea', 'totArea', 'grndFlrCnt', 'ugrndFlrCnt', 'mainPurpsCdNm', 'useAprDay', 'rserthqkDsgnApplyYn']) {
        console.log(`  ${k}: ${JSON.stringify(first[k])}`);
      }
    } else {
      console.log('items 없음 — body:', JSON.stringify(body)?.slice(0, 500));
    }
  } catch {
    console.log('JSON 파싱 실패 — 원문 앞부분:', text.slice(0, 600));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
