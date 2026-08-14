/**
 * 좌표 변환 — 파이프라인(scripts/build-region.ts, analyze-join.ts)과 테스트가 공유하는 단일 정의.
 * 행안부 LOCALDATA 좌표계는 EPSG:5174로 실측 판정됨 (2026-08-13, 상호명 매칭 4,285쌍
 * 거리 비교: 5174 중앙값 2.1m vs 2097 중앙값 254.9m — MEMORY.md).
 */
import proj4 from 'proj4';

/** EPSG:5174 — 중부원점(Bessel), 보정 경도 127.0028902777778 */
export const PROJ_5174 =
  '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43';

/** EPSG:2097 — 중부원점(Bessel), 경도 127 (기각된 후보 — 판정 로직 유지용) */
export const PROJ_2097 =
  '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43';

export const KOREA_BBOX = { minLng: 124.5, maxLng: 132.0, minLat: 33.0, maxLat: 39.5 };

/** 평면 좌표(m) → WGS84 [lng, lat]. 결측(NaN/Infinity)은 [NaN, NaN] — bbox 검사에서 걸러진다 */
export function toWgs84(projDef: string, x: number, y: number): [number, number] {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [NaN, NaN];
  return proj4(projDef, proj4.WGS84, [x, y]) as [number, number];
}

export function inKoreaBbox(lng: number, lat: number): boolean {
  return lng >= KOREA_BBOX.minLng && lng <= KOREA_BBOX.maxLng && lat >= KOREA_BBOX.minLat && lat <= KOREA_BBOX.maxLat;
}
