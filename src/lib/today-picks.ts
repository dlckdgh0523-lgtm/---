/**
 * "오늘의 접점" 선정 — 순수 함수. 대시보드 섹션과 메일 발송이 이 함수 하나를 쓴다.
 *
 * 규칙 (2026-08-13 지시):
 * 1) 오늘 기준 우선 접촉 / N주년 도래 / 업종 전환 의심만 추출 ('그 외' 제외)
 * 2) 업종별 24개월 폐업률(존속 위험) 낮은 순 정렬 — 수치는 생존 분석 산출물이 단일 출처,
 *    표본 부족 업종은 전체 평균으로 대체 (표본 부족을 근거로 쓰지 않는다)
 * 3) 동순위는 그룹 우선순위(우선 접촉 > 주년 > 전환 의심) → 경과 오름차순
 * 4) 상위 N건 반환
 */
import industryRisk from '@/data/industry-risk.generated.json';
import { anniversaryOf, GROUPS, toViews, type MarkerGroup } from '@/lib/place-view';
import type { Place } from '@/types';

interface IndustryEntry {
  closure24: number;
  reliable: boolean;
}
const INDUSTRIES = industryRisk.industries as Record<string, IndustryEntry>;
const survKey = (cat: string) => (cat.startsWith('골프') ? '골프시설' : cat);
const GROUP_ORDER: Record<MarkerGroup, number> = { priority: 0, anniversary: 1, switch: 2, other: 9 };

export interface TodayPick {
  placeId: string;
  name: string;
  category: string;
  address: string;
  elapsed: number;
  stageLabel: string;
  group: MarkerGroup;
  groupLabel: string;
  anniversary: number | null;
  /** 업종 24개월 폐업률 (실측 또는 평균 대체) */
  industryClosure24: number;
  closureSource: 'industry' | 'average';
}

export function industryClosureOf(categoryLarge: string): { value: number; source: 'industry' | 'average' } {
  const entry = INDUSTRIES[survKey(categoryLarge)];
  if (entry && entry.reliable) return { value: entry.closure24, source: 'industry' };
  return { value: industryRisk.avgClosure24, source: 'average' };
}

/**
 * @param categoryFilter 업종 대분류 필터 (예: '일반음식점'). 미지정 시 전체 — 메일 발송은 전체를 쓴다.
 */
export function pickTodayContacts(
  places: Place[],
  now: Date = new Date(),
  n = 5,
  categoryFilter?: string,
): TodayPick[] {
  return toViews(places, now)
    .filter((v) => v.group !== 'other')
    .filter((v) => !categoryFilter || v.place.category.large === categoryFilter)
    .map((v) => {
      const closure = industryClosureOf(v.place.category.large);
      return { v, closure };
    })
    .sort(
      (a, b) =>
        a.closure.value - b.closure.value ||
        GROUP_ORDER[a.v.group] - GROUP_ORDER[b.v.group] ||
        a.v.elapsed - b.v.elapsed,
    )
    .slice(0, n)
    .map(({ v, closure }) => ({
      placeId: v.place.id,
      name: v.place.name,
      category: v.place.category.large,
      address: v.place.address,
      elapsed: v.elapsed,
      stageLabel: v.stage.label,
      group: v.group,
      groupLabel: GROUPS.find((g) => g.key === v.group)!.label,
      anniversary: v.group === 'anniversary' ? anniversaryOf(v.elapsed) : null,
      industryClosure24: closure.value,
      closureSource: closure.source,
    }));
}

/** 메일·화면 공용 요약 한 줄: 업종별 존속 위험 (낮은 순 상위 3개 업종) */
export function industrySummaryLine(): string {
  const entries = Object.entries(INDUSTRIES)
    .filter(([, v]) => v.reliable)
    .sort(([, a], [, b]) => a.closure24 - b.closure24);
  if (entries.length === 0) return '';
  const safe = entries.slice(0, 2).map(([c, v]) => `${c} ${Math.round(v.closure24 * 100)}%`);
  const risky = entries[entries.length - 1];
  return `업종별 24개월 폐업률: ${safe.join(', ')}가 낮고 ${risky[0]} ${Math.round(risky[1].closure24 * 100)}%가 가장 높습니다 (용산 실측).`;
}
