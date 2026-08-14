/** 경과 개월 계산·단계 라벨·마커 그룹 분류 검증 — 지도/대시보드/메일이 공유하는 함수 */
import { anniversaryOf, elapsedMonthsOf, groupOf } from '@/lib/place-view';
import { stageFor } from '@/config/elapsed-stages';
import type { Place } from '@/types';

const NOW = new Date('2026-08-14');

function placeWith(over: Partial<Place>): Place {
  return {
    id: 'p-1',
    name: '테스트',
    category: { large: '일반음식점', raw: '' },
    address: '',
    jibunAddress: '',
    lat: 37.5,
    lng: 127.0,
    licenseDate: '2026-04-01',
    ...over,
  } as Place;
}

describe('elapsedMonthsOf', () => {
  it('연월 차이 개월수', () => {
    expect(elapsedMonthsOf('2026-04-01', NOW)).toBe(4);
    expect(elapsedMonthsOf('2025-08-01', NOW)).toBe(12);
  });
  it('미래 인허가일은 0으로 클램프', () => {
    expect(elapsedMonthsOf('2027-01-01', NOW)).toBe(0);
  });
});

describe('stageFor — 구간 경계 (2026-08-13 확정 구간)', () => {
  const cases: [number, string][] = [
    [0, 'watching'],
    [2, 'watching'],
    [3, 'priority'],
    [6, 'priority'],
    [7, 'observing'],
    [10, 'observing'],
    [11, 'renewal'],
    [13, 'renewal'],
    [14, 'year-one'],
    [23, 'year-one'],
    [24, 'recheck'],
    [360, 'recheck'],
  ];
  it.each(cases)('%i개월 → %s', (m, stage) => {
    expect(stageFor(m).stage).toBe(stage);
  });
});

describe('groupOf — 마커 그룹 우선순위', () => {
  it('업종 전환 의심이 최우선', () => {
    const p = placeWith({ suspectedRelicense: { prevName: 'x', prevClosedAt: '2026-01-01', prevCategory: 'y' } });
    expect(groupOf(p, 4)).toBe('switch'); // 우선 접촉 구간이어도 전환 의심 우선
  });
  it('3~6개월 → 우선 접촉', () => {
    expect(groupOf(placeWith({}), 3)).toBe('priority');
    expect(groupOf(placeWith({}), 6)).toBe('priority');
  });
  it('N주년 창(12k ± 1개월, 11개월 이상)', () => {
    expect(groupOf(placeWith({}), 11)).toBe('anniversary');
    expect(groupOf(placeWith({}), 12)).toBe('anniversary');
    expect(groupOf(placeWith({}), 13)).toBe('anniversary');
    expect(groupOf(placeWith({}), 23)).toBe('anniversary');
    expect(groupOf(placeWith({}), 24)).toBe('anniversary');
    expect(groupOf(placeWith({}), 36)).toBe('anniversary');
  });
  it('그 외 구간', () => {
    expect(groupOf(placeWith({}), 0)).toBe('other');
    expect(groupOf(placeWith({}), 8)).toBe('other');
    expect(groupOf(placeWith({}), 15)).toBe('other');
  });
});

describe('anniversaryOf', () => {
  it('가장 가까운 주년', () => {
    expect(anniversaryOf(11)).toBe(1);
    expect(anniversaryOf(13)).toBe(1);
    expect(anniversaryOf(23)).toBe(2);
    expect(anniversaryOf(24)).toBe(2);
  });
});
