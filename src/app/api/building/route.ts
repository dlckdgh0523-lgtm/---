/**
 * 건축물대장 온디맨드 조회 (표제부) — 서버 라우트.
 * - 키는 서버 전용 환경변수 BUILDING_HUB_API_KEY (.env.local, 클라이언트 번들 미노출)
 * - 전체 조인 금지: 사용자가 사업장을 클릭했을 때만 호출, 같은 번지는 캐시 재사용 (일 10,000건 제한)
 * - 실패해도 앱이 죽지 않도록 BuildingLookup 판별 유니온으로 응답 (graceful degradation)
 * - 필드명은 2026-08-13 실호출로 확인한 실제 응답 기준 (MEMORY.md)
 */
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { parseJibunToParams } from '@/lib/jibun';
import type { BuildingLookup, Place } from '@/types';

const packCache = new Map<string, { places: Place[]; bjdong: Record<string, string>; prefix: string }>();
const resultCache = new Map<string, BuildingLookup>();

function loadPack(region: string) {
  if (packCache.has(region)) return packCache.get(region)!;
  const dir = path.join(process.cwd(), 'public', 'data', 'regions', region);
  const places = JSON.parse(fs.readFileSync(path.join(dir, 'places.json'), 'utf-8')) as Place[];
  const bjdong = (JSON.parse(fs.readFileSync(path.join(dir, 'bjdong.json'), 'utf-8')) as { bjdong: Record<string, string> }).bjdong;
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf-8')) as { name: string };
  const pack = { places, bjdong, prefix: meta.name };
  packCache.set(region, pack);
  return pack;
}

export async function GET(req: NextRequest) {
  const key = process.env.BUILDING_HUB_API_KEY;
  if (!key) return Response.json({ status: 'disabled' } satisfies BuildingLookup);

  const region = req.nextUrl.searchParams.get('region') ?? '';
  const placeId = req.nextUrl.searchParams.get('id') ?? '';
  if (!/^\d{5}$/.test(region) || !placeId) {
    return Response.json({ status: 'error', placeId, message: 'bad params' } satisfies BuildingLookup, { status: 400 });
  }

  try {
    const pack = loadPack(region);
    const place = pack.places.find((p) => p.id === placeId);
    if (!place?.jibunAddress) return Response.json({ status: 'not_found', placeId } satisfies BuildingLookup);

    const params = parseJibunToParams(place.jibunAddress, pack.prefix, pack.bjdong);
    if (!params) return Response.json({ status: 'not_found', placeId } satisfies BuildingLookup);

    const cacheKey = `${params.sigunguCd}-${params.bjdongCd}-${params.platGbCd}-${params.bun}-${params.ji}`;
    if (resultCache.has(cacheKey)) return Response.json(resultCache.get(cacheKey));

    const qs = new URLSearchParams({
      sigunguCd: params.sigunguCd,
      bjdongCd: params.bjdongCd,
      platGbCd: params.platGbCd,
      bun: params.bun,
      ji: params.ji,
      _type: 'json',
      numOfRows: '10',
      pageNo: '1',
    });
    const res = await fetch(
      `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${encodeURIComponent(key)}&${qs}`,
      { signal: AbortSignal.timeout(8000) },
    );
    const json = await res.json();
    if (json?.response?.header?.resultCode !== '00') {
      return Response.json({ status: 'error', placeId, message: json?.response?.header?.resultMsg ?? 'api error' } satisfies BuildingLookup);
    }
    const items = json?.response?.body?.items?.item;
    const first = Array.isArray(items) ? items[0] : items;
    if (!first) {
      const miss: BuildingLookup = { status: 'not_found', placeId };
      resultCache.set(cacheKey, miss);
      return Response.json(miss);
    }
    const day = (v: unknown) =>
      typeof v === 'string' && /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null;
    const result: BuildingLookup = {
      status: 'ok',
      data: {
        placeId,
        mainStructure: first.strctCdNm || null,
        roofStructure: first.roofCdNm || null,
        buildingArea: typeof first.archArea === 'number' ? first.archArea : null,
        totalFloorArea: typeof first.totArea === 'number' ? first.totArea : null,
        floorsAbove: typeof first.grndFlrCnt === 'number' ? first.grndFlrCnt : null,
        floorsBelow: typeof first.ugrndFlrCnt === 'number' ? first.ugrndFlrCnt : null,
        mainUse: first.mainPurpsCdNm || null,
        approvalDate: day(first.useAprDay),
        earthquakeResistant: first.rserthqkDsgnApplyYn === '1' ? true : first.rserthqkDsgnApplyYn === '0' ? false : null,
        fetchedAt: new Date().toISOString(),
      },
    };
    resultCache.set(cacheKey, result);
    return Response.json(result);
  } catch (e) {
    return Response.json({ status: 'error', placeId, message: e instanceof Error ? e.message : 'unknown' } satisfies BuildingLookup);
  }
}
