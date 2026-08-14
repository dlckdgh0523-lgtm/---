/**
 * Kaplan-Meier·조건부 생존 검증 — 파이프라인(build-survival.ts)과 공유하는 단일 구현.
 * 기대값은 전부 손계산 (우측 절단 처리 포함).
 */
import { bucketHazard, conditionalSurvival, kaplanMeier } from '@/lib/survival-math';

describe('kaplanMeier', () => {
  it('사건 없음: 생존율 전 구간 1', () => {
    const surv = kaplanMeier(
      [
        { t: 5, event: false },
        { t: 10, event: false },
      ],
      12,
    );
    expect(surv.every((s) => s === 1)).toBe(true);
  });

  it('절단 없는 전멸: t=1에 전원 폐업 → S(0)=1, S(1)=0', () => {
    const surv = kaplanMeier(Array.from({ length: 10 }, () => ({ t: 1, event: true })), 3);
    expect(surv[0]).toBe(1);
    expect(surv[1]).toBe(0);
  });

  it('손계산 예제 (절단 혼합): 4명 — t1 폐업, t2 폐업, t2 절단, t3 절단', () => {
    const surv = kaplanMeier(
      [
        { t: 1, event: true },
        { t: 2, event: true },
        { t: 2, event: false },
        { t: 3, event: false },
      ],
      3,
    );
    // m1: 4명 중 1 폐업 → 3/4. m2: 3명 중 1 폐업 → 3/4 × 2/3 = 1/2. m3: 사건 없음.
    expect(surv[1]).toBeCloseTo(0.75, 10);
    expect(surv[2]).toBeCloseTo(0.5, 10);
    expect(surv[3]).toBeCloseTo(0.5, 10);
  });

  it('절단은 사건이 아니다: 절단을 폐업으로 잘못 세면 생존율이 낮아진다', () => {
    const censored = kaplanMeier(
      [
        { t: 1, event: true },
        { t: 2, event: false },
        { t: 2, event: false },
      ],
      3,
    );
    const asEvents = kaplanMeier(
      [
        { t: 1, event: true },
        { t: 2, event: true },
        { t: 2, event: true },
      ],
      3,
    );
    expect(censored[3]).toBeGreaterThan(asEvents[3]);
  });
});

describe('bucketHazard', () => {
  it('구간 조건부 폐업률 = 1 − S(end)/S(start−1)', () => {
    const surv = [1, 0.75, 0.5, 0.5];
    expect(bucketHazard(surv, 1, 2, 3)).toBeCloseTo(0.5, 10); // 1 − 0.5/1
    expect(bucketHazard(surv, 2, 3, 3)).toBeCloseTo(1 - 0.5 / 0.75, 10);
  });
  it('시작 생존율 0이면 0 (0 나눗셈 방어)', () => {
    expect(bucketHazard([1, 0, 0], 2, 2, 2)).toBe(0);
  });
});

describe('conditionalSurvival', () => {
  it('사건 없음: 생존 1, CI 폭 0', () => {
    const r = conditionalSurvival(
      Array.from({ length: 50 }, () => ({ t: 30, event: false })),
      6,
      24,
    );
    expect(r.survival).toBe(1);
    expect(r.ciLow).toBe(1);
    expect(r.ciHigh).toBe(1);
  });

  it('표본 수 = 재기점(fromAge) 생존자 수 — 30건 경계로 reliable 판정', () => {
    const under = conditionalSurvival(
      Array.from({ length: 29 }, () => ({ t: 40, event: false })),
      6,
      24,
    );
    const over = conditionalSurvival(
      Array.from({ length: 30 }, () => ({ t: 40, event: false })),
      6,
      24,
    );
    expect(under.atRisk).toBe(29);
    expect(under.reliable).toBe(false);
    expect(over.reliable).toBe(true);
  });

  it('fromAge 이전 이탈자는 표본에서 제외된다', () => {
    const r = conditionalSurvival(
      [
        { t: 3, event: true }, // 재기점(6개월) 전 폐업 — 제외
        { t: 40, event: false },
        { t: 40, event: false },
      ],
      6,
      24,
    );
    expect(r.atRisk).toBe(2);
    expect(r.survival).toBe(1);
  });

  it('손계산: 재기점 생존 4명 중 구간 내 1 폐업 → 0.75, CI는 [0,1] 내 점추정 좌우', () => {
    const r = conditionalSurvival(
      [
        { t: 10, event: true }, // rel=4에 폐업
        { t: 40, event: false },
        { t: 40, event: false },
        { t: 40, event: false },
      ],
      6,
      24,
    );
    expect(r.survival).toBeCloseTo(0.75, 10);
    expect(r.ciLow).toBeGreaterThanOrEqual(0);
    expect(r.ciHigh).toBeLessThanOrEqual(1);
    expect(r.ciLow).toBeLessThan(r.survival);
    expect(r.ciHigh).toBeGreaterThan(r.survival);
  });
});
