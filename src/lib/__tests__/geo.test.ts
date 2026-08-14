/**
 * 좌표 변환 검증 — EPSG:5174(실측 판정 좌표계) ↔ WGS84.
 * 절대 기준점 대신 왕복 정합성과 5174/2097 판별력을 검증한다
 * (실좌표계 판정 자체는 2026-08-13 상호명 매칭 4,285쌍으로 수행 — MEMORY).
 */
import proj4 from 'proj4';
import { inKoreaBbox, PROJ_2097, PROJ_5174, toWgs84 } from '@/lib/geo';

describe('toWgs84 (EPSG:5174)', () => {
  it('왕복 변환 정합: WGS84 → 5174 → WGS84 오차 < 1e-6도(≈0.1m)', () => {
    const seoul: [number, number] = [126.9784, 37.5665];
    const [x, y] = proj4(proj4.WGS84, PROJ_5174, seoul);
    const [lng, lat] = toWgs84(PROJ_5174, x, y);
    expect(Math.abs(lng - seoul[0])).toBeLessThan(1e-6);
    expect(Math.abs(lat - seoul[1])).toBeLessThan(1e-6);
  });

  it('서울 평면좌표는 한국 bbox 안에 떨어진다', () => {
    const [x, y] = proj4(proj4.WGS84, PROJ_5174, [126.99, 37.53]);
    const [lng, lat] = toWgs84(PROJ_5174, x, y);
    expect(inKoreaBbox(lng, lat)).toBe(true);
  });

  it('5174와 2097은 같은 평면좌표에서 다른 경도를 준다 (판별 가능성 — 보정 경도 차)', () => {
    const [x, y] = proj4(proj4.WGS84, PROJ_5174, [126.99, 37.53]);
    const [lng5174] = toWgs84(PROJ_5174, x, y);
    const [lng2097] = toWgs84(PROJ_2097, x, y);
    // 두 정의의 lon_0 차이 ≈ 0.00289도 ≈ 250m — bbox로는 변별 불가했던 이유이자 거리 비교로 판정한 근거
    expect(Math.abs(lng5174 - lng2097)).toBeGreaterThan(0.002);
    expect(Math.abs(lng5174 - lng2097)).toBeLessThan(0.004);
  });

  it('좌표 결측(NaN)은 NaN을 반환 — 파이프라인에서 bbox 검사로 걸러진다', () => {
    const [lng, lat] = toWgs84(PROJ_5174, NaN, NaN);
    expect(Number.isNaN(lng) || Number.isNaN(lat)).toBe(true);
    expect(inKoreaBbox(lng, lat)).toBe(false);
  });
});
