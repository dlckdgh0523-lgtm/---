/**
 * 서울시 실시간 도시데이터 프록시 — 서버 라우트.
 * - 키: SEOUL_DATA_API_KEY (.env.local, 서버 전용). 없으면 'disabled' — 화면은 죽지 않는다.
 * - 실시간 데이터라 5분 캐시로 과도한 호출을 피한다.
 * - 필드명은 2026-08-13 sample 키 실호출로 확인: LIVE_PPLTN_STTS(PPLTN_RATE_0~70,
 *   MALE/FEMALE_PPLTN_RATE, RESNT/NON_RESNT_PPLTN_RATE, AREA_CONGEST_LVL, FCST_PPLTN),
 *   EVENT_STTS(EVENT_NM, EVENT_PERIOD, EVENT_PLACE, PAY_YN, URL — '카테고리' 필드는 없음).
 */
import { NextRequest } from 'next/server';
import { ALL_OUTREACH_PLACES } from '@/data/outreach-places';

export interface CitySnapshot {
  areaName: string;
  congestLvl: string;
  congestMsg: string;
  ppltnMin: number;
  ppltnMax: number;
  maleRate: number;
  femaleRate: number;
  ageRates: Record<string, number>; // '0'|'10'|...|'70' → %
  resntRate: number;
  nonResntRate: number;
  observedAt: string;
  forecast: { time: string; lvl: string; min: number; max: number }[];
  events: { name: string; period: string; place: string; payYn: string | null; url: string | null }[];
}

type CityLookup =
  | { status: 'ok'; data: CitySnapshot }
  | { status: 'disabled' }
  | { status: 'error'; areaName: string; message: string };

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: CityLookup }>();

export async function GET(req: NextRequest) {
  const key = process.env.SEOUL_DATA_API_KEY;
  if (!key) return Response.json({ status: 'disabled' } satisfies CityLookup);

  const area = req.nextUrl.searchParams.get('area') ?? '';
  if (!ALL_OUTREACH_PLACES.includes(area)) {
    return Response.json({ status: 'error', areaName: area, message: '허용되지 않은 장소' } satisfies CityLookup, { status: 400 });
  }

  const cached = cache.get(area);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return Response.json(cached.value);

  try {
    const res = await fetch(
      `http://openapi.seoul.go.kr:8088/${key}/json/citydata/1/5/${encodeURIComponent(area)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    const json = await res.json();
    const city = json?.CITYDATA;
    const live = Array.isArray(city?.LIVE_PPLTN_STTS) ? city.LIVE_PPLTN_STTS[0] : city?.LIVE_PPLTN_STTS;
    if (!live) throw new Error(json?.RESULT?.['RESULT.MESSAGE'] ?? 'LIVE_PPLTN_STTS 없음');
    const num = (v: unknown) => (Number.isFinite(parseFloat(String(v))) ? parseFloat(String(v)) : 0);
    const events = (Array.isArray(city?.EVENT_STTS) ? city.EVENT_STTS : []).map((e: Record<string, unknown>) => ({
      name: String(e.EVENT_NM ?? ''),
      period: String(e.EVENT_PERIOD ?? ''),
      place: String(e.EVENT_PLACE ?? ''),
      payYn: e.PAY_YN == null ? null : String(e.PAY_YN),
      url: e.URL == null ? null : String(e.URL),
    }));
    const value: CityLookup = {
      status: 'ok',
      data: {
        areaName: String(city.AREA_NM ?? area),
        congestLvl: String(live.AREA_CONGEST_LVL ?? ''),
        congestMsg: String(live.AREA_CONGEST_MSG ?? ''),
        ppltnMin: num(live.AREA_PPLTN_MIN),
        ppltnMax: num(live.AREA_PPLTN_MAX),
        maleRate: num(live.MALE_PPLTN_RATE),
        femaleRate: num(live.FEMALE_PPLTN_RATE),
        ageRates: Object.fromEntries(['0', '10', '20', '30', '40', '50', '60', '70'].map((a) => [a, num(live[`PPLTN_RATE_${a}`])])),
        resntRate: num(live.RESNT_PPLTN_RATE),
        nonResntRate: num(live.NON_RESNT_PPLTN_RATE),
        observedAt: String(live.PPLTN_TIME ?? ''),
        forecast: (Array.isArray(live.FCST_PPLTN) ? live.FCST_PPLTN : []).map((f: Record<string, unknown>) => ({
          time: String(f.FCST_TIME ?? ''),
          lvl: String(f.FCST_CONGEST_LVL ?? ''),
          min: num(f.FCST_PPLTN_MIN),
          max: num(f.FCST_PPLTN_MAX),
        })),
        events,
      },
    };
    cache.set(area, { at: Date.now(), value });
    return Response.json(value);
  } catch (e) {
    const value: CityLookup = { status: 'error', areaName: area, message: e instanceof Error ? e.message : 'unknown' };
    return Response.json(value);
  }
}
