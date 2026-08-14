/**
 * 생존 분석 수학 — 데이터 파이프라인(scripts/build-survival.ts)과 테스트가 공유하는 단일 구현.
 * 이산(월) Kaplan-Meier, 구간 조건부 폐업률, 조건부 KM + Greenwood 95% CI.
 * 우측 절단(영업 중 = censored) 처리 포함. 표본 30건 미만 reliable=false (2026-08-13 지시).
 */

export interface SurvivalRecord {
  t: number; // 존속 개월 (사건 또는 절단 시점)
  event: boolean; // true = 폐업(사건), false = 절단(관찰 종료 시점까지 영업 중)
}

/** 이산(월) Kaplan-Meier 생존 곡선 S(0..maxMonth) */
export function kaplanMeier(recs: SurvivalRecord[], maxMonth: number): number[] {
  const events = new Array(maxMonth + 1).fill(0);
  const exits = new Array(maxMonth + 1).fill(0); // 사건+절단 모두 (t에서 위험집합 이탈)
  for (const r of recs) {
    const t = Math.min(Math.max(0, r.t), maxMonth);
    exits[t] += 1;
    if (r.event) events[t] += 1;
  }
  const surv: number[] = [];
  let atRisk = recs.length;
  let s = 1;
  for (let m = 0; m <= maxMonth; m++) {
    if (atRisk > 0) s *= 1 - events[m] / atRisk;
    surv.push(s);
    atRisk -= exits[m];
  }
  return surv;
}

/** 구간 조건부 폐업률: 시작 시점 생존자 중 구간 내 폐업 비율 = 1 - S(end)/S(start) */
export function bucketHazard(surv: number[], start: number, end: number, maxMonth: number): number {
  const s0 = start === 0 ? 1 : surv[start - 1];
  const s1 = surv[Math.min(end, maxMonth)];
  return s0 > 0 ? 1 - s1 / s0 : 0;
}

export interface ConditionalSurvival {
  survival: number;
  ciLow: number;
  ciHigh: number;
  atRisk: number;
  reliable: boolean;
}

export const MIN_RELIABLE_SAMPLE = 30;

/**
 * 나이 fromAge 생존자를 재기점으로 한 조건부 KM + Greenwood 95% 신뢰구간.
 * atRisk = 재기점 위험집합 크기 — "표본 수"로 이 값을 쓴다 (전체 n이 아니라).
 * 표본 30건 미만이면 reliable=false → 화면·계산기에서 점추정 노출 금지.
 */
export function conditionalSurvival(recs: SurvivalRecord[], fromAge: number, horizon: number): ConditionalSurvival {
  const sub = recs.filter((r) => r.t >= fromAge + 1);
  const atRisk0 = sub.length;
  const events = new Array(horizon + 1).fill(0);
  const exits = new Array(horizon + 1).fill(0);
  for (const r of sub) {
    const rel = r.t - fromAge;
    const t = Math.min(rel, horizon);
    exits[t] += 1;
    if (r.event && rel <= horizon) events[t] += 1;
  }
  let n = atRisk0;
  let s = 1;
  let greenwood = 0;
  for (let m = 0; m <= horizon; m++) {
    const d = events[m];
    if (n > 0 && d > 0) {
      s *= 1 - d / n;
      if (n - d > 0) greenwood += d / (n * (n - d));
    }
    n -= exits[m];
  }
  const se = s * Math.sqrt(greenwood);
  return {
    survival: s,
    ciLow: Math.max(0, s - 1.96 * se),
    ciHigh: Math.min(1, s + 1.96 * se),
    atRisk: atRisk0,
    reliable: atRisk0 >= MIN_RELIABLE_SAMPLE,
  };
}
