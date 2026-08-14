/**
 * LLM용 사업장 컨텍스트 로더 — 서버 전용, 결정론적. 시나리오·롤플레잉이 공용한다.
 * 절대 원칙: 여기서 만드는 컨텍스트에 금액·키·법령 필드는 없다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { anniversaryOf, elapsedMonthsOf, groupOf } from '@/lib/place-view';
import type { ScenarioContext } from '@/lib/llm/types';
import type { Place } from '@/types';

interface SurvivalLite {
  cond24at6: { byCategory: Record<string, { survival: number; reliable: boolean }> };
}

const survKey = (cat: string) => (cat.startsWith('골프') ? '골프시설' : cat);

export function loadPlaceContext(region: string, placeId: string): { place: Place; context: ScenarioContext } | null {
  if (!/^\d{5}$/.test(region)) return null;
  const dir = path.join(process.cwd(), 'public', 'data', 'regions', region);
  let places: Place[];
  let regionName: string;
  try {
    places = JSON.parse(fs.readFileSync(path.join(dir, 'places.json'), 'utf-8')) as Place[];
    regionName = (JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf-8')) as { name: string }).name;
  } catch {
    return null;
  }
  const place = places.find((p) => p.id === placeId);
  if (!place) return null;

  let closurePct: number | null = null;
  try {
    const survival = JSON.parse(fs.readFileSync(path.join(dir, 'survival.json'), 'utf-8')) as SurvivalLite;
    const stat = survival.cond24at6.byCategory[survKey(place.category.large)];
    if (stat?.reliable) closurePct = Math.round((1 - stat.survival) * 1000) / 10;
  } catch {
    /* 생존 분석 없으면 수치 미제공 */
  }

  const elapsed = elapsedMonthsOf(place.licenseDate);
  const context: ScenarioContext = {
    regionName,
    industry: place.category.large,
    subCategory: place.category.medium || null,
    elapsedMonths: elapsed,
    anniversaryYears: groupOf(place, elapsed) === 'anniversary' ? anniversaryOf(elapsed) : null,
    suspectedRelicense: place.suspectedRelicense
      ? { prevCategory: place.suspectedRelicense.prevCategory, prevClosedAt: place.suspectedRelicense.prevClosedAt }
      : null,
    industryClosure24Pct: closurePct,
  };
  return { place, context };
}
