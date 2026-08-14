/**
 * 지역 레지스트리 — public/data/regions/index.json이 "어느 지역이 준비됐는지"의 단일 출처.
 * 코드에 지역명을 하드코딩하지 않는다. 파일이 없으면(팩 0개) 빈 레지스트리로 동작.
 */

export interface RegionPackEntry {
  code: string; // 시군구코드
  name: string; // "서울특별시 용산구"
  builtAt: string;
  recordCount: number;
}

export interface RegionRegistry {
  updatedAt: string;
  regions: RegionPackEntry[];
}

const EMPTY: RegionRegistry = { updatedAt: '', regions: [] };

export async function fetchRegionRegistry(): Promise<RegionRegistry> {
  try {
    const res = await fetch('/data/regions/index.json', { cache: 'no-store' });
    if (!res.ok) return EMPTY;
    return (await res.json()) as RegionRegistry;
  } catch {
    return EMPTY;
  }
}

export function findPack(registry: RegionRegistry, sigunguCode: string): RegionPackEntry | null {
  return registry.regions.find((r) => r.code === sigunguCode) ?? null;
}
