/**
 * 익명 구조값 저장소 + 역산 요약 (2026-08-14 수집 정책).
 * - 레코드에 이메일·계정 ID 없음 (조인 불가). id는 서버가 randomUUID로 부여.
 * - Redis LPUSH(있으면) / 파일(로컬 폴백).
 * - 역산: 소속사 구분별 표본 30건 이상이면 중앙값을 신규 사용자 기본 프리셋으로 제공.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { redisAvailable, redisCommand } from '@/lib/server/redis';
import { clawbackRateFor } from '@/lib/cashflow';
import type { ClawbackBracket, ContractStructureRecord, StructureRecord } from '@/types';

const FILES = {
  structure: path.join(process.cwd(), 'data', 'stats-structure.json'),
  contract: path.join(process.cwd(), 'data', 'stats-contract.json'),
};
const REDIS_KEYS = { structure: 'ifc:stats:structure', contract: 'ifc:stats:contract' };

/** 프리셋 역산 신뢰 문턱 — 인사이트·관리자와 동일 원칙 */
export const STRUCTURE_MIN_SAMPLE = 30;

/**
 * k-익명성 임계값 — 교차 필터 조합(셀)의 표본이 이 미만이면 수치 자체를 차단한다.
 * 조합을 좁히면 개인이 특정될 수 있으므로(예: GA대형×저축성 1명), 셀 n<K면 개인 특정 위험으로 본다.
 * STRUCTURE_MIN_SAMPLE(30)은 "통계적 신뢰" 문턱이고, 이건 "개인 특정 방지" 문턱 — 목적이 다르다.
 */
export const K_ANON_MIN = 5;

type Kind = 'structure' | 'contract';

async function append(kind: Kind, record: unknown): Promise<void> {
  if (redisAvailable()) {
    await redisCommand(['LPUSH', REDIS_KEYS[kind], JSON.stringify(record)]);
    return;
  }
  const file = FILES[kind];
  let list: unknown[] = [];
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown[];
  } catch {
    list = [];
  }
  list.push(record);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list, null, 2));
}

async function loadAll<T>(kind: Kind): Promise<T[]> {
  if (redisAvailable()) {
    const raw = (await redisCommand(['LRANGE', REDIS_KEYS[kind], 0, 9999])) as string[] | null;
    return (raw ?? []).map((r) => JSON.parse(r) as T);
  }
  try {
    return JSON.parse(fs.readFileSync(FILES[kind], 'utf-8')) as T[];
  } catch {
    return [];
  }
}

export async function addStructureRecord(payload: Omit<StructureRecord, 'id'>): Promise<void> {
  await append('structure', { ...payload, id: crypto.randomUUID() } satisfies StructureRecord);
}

export async function addContractRecord(payload: Omit<ContractStructureRecord, 'id'>): Promise<void> {
  await append('contract', { ...payload, id: crypto.randomUUID() } satisfies ContractStructureRecord);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface TierStructureSummary {
  n: number; // 구조값(선지급률) 표본 수
  reliable: boolean; // n >= 30
  advanceRateMedian: number | null;
  /** 표준 점검 개월(6/12/24)의 환수율 중앙값으로 재구성한 구간표 */
  clawbackScheduleMedian: ClawbackBracket[] | null;
  advanceRates: number[]; // 분포 표시용 (관리자)
}

/** 소속사 구분별 구조 요약 — 프리셋 역산 + 관리자 분포 */
export async function structureSummary(): Promise<Record<string, TierStructureSummary>> {
  const records = await loadAll<StructureRecord>('structure');
  const byTier = new Map<string, StructureRecord[]>();
  for (const r of records) {
    if (r.enteredBy !== 'user') continue; // 방어 — 직접 입력 값만
    const list = byTier.get(r.companyTier) ?? [];
    list.push(r);
    byTier.set(r.companyTier, list);
  }
  const out: Record<string, TierStructureSummary> = {};
  for (const [tier, list] of byTier) {
    const advanceRates = list.map((r) => r.advanceRate).filter((v): v is number => typeof v === 'number');
    const schedules = list.map((r) => r.clawbackSchedule).filter((v): v is ClawbackBracket[] => Array.isArray(v));
    const n = advanceRates.length;
    const reliable = n >= STRUCTURE_MIN_SAMPLE;
    let scheduleMedian: ClawbackBracket[] | null = null;
    if (schedules.length >= STRUCTURE_MIN_SAMPLE) {
      const checkpoints = [6, 12, 24];
      scheduleMedian = checkpoints.map((m) => ({
        maxMonth: m,
        clawbackRate: median(schedules.map((s) => clawbackRateFor(m, s))) ?? 0,
      }));
    }
    out[tier] = {
      n,
      reliable,
      advanceRateMedian: reliable ? median(advanceRates) : null, // 표본 부족 시 점추정 미제공
      clawbackScheduleMedian: scheduleMedian,
      advanceRates,
    };
  }
  return out;
}

export interface RiskDistributionSummary {
  total: number;
  byProduct: Record<string, { high: number; medium: number; low: number }>;
  byIndustry: Record<string, { high: number; medium: number; low: number }>;
}

/** 상품·업종별 위험도 분포 — 관리자 화면 "수집 불가" 빈칸을 채우는 데이터 */
export async function contractRiskDistribution(): Promise<RiskDistributionSummary> {
  const records = await loadAll<ContractStructureRecord>('contract');
  const byProduct: RiskDistributionSummary['byProduct'] = {};
  const byIndustry: RiskDistributionSummary['byIndustry'] = {};
  for (const r of records) {
    if (r.enteredBy !== 'user') continue;
    const p = (byProduct[r.productLine] ??= { high: 0, medium: 0, low: 0 });
    p[r.riskLevel] += 1;
    if (r.businessCategory) {
      const i = (byIndustry[r.businessCategory] ??= { high: 0, medium: 0, low: 0 });
      i[r.riskLevel] += 1;
    }
  }
  return { total: records.length, byProduct, byIndustry };
}

// ============ 교차 분석 (2026-08-14 지시 B) ============

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

/** n<K_ANON이면 null(개인 특정 위험 차단), n<30이면 masked(통계 신뢰 부족), 아니면 값 */
export interface Distribution {
  n: number;
  blocked: boolean; // k-익명성 차단 (n < K_ANON_MIN)
  masked: boolean; // 통계 신뢰 부족 (n < 30)
  median: number | null;
  q1: number | null;
  q3: number | null;
  min: number | null;
  max: number | null;
}

function distribution(values: number[]): Distribution {
  const n = values.length;
  const blocked = n < K_ANON_MIN;
  const masked = n < STRUCTURE_MIN_SAMPLE;
  if (blocked || n === 0) {
    return { n, blocked, masked, median: null, q1: null, q3: null, min: null, max: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  // 통계 신뢰 부족(masked)이면 대표값은 주지만 화면이 "표본 부족"으로 처리. 차단(blocked)이면 전부 null.
  return {
    n,
    blocked,
    masked,
    median: quantile(sorted, 0.5),
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

const TIERS = ['captive-life', 'captive-nonlife', 'large-ga', 'small-ga'] as const;
const CHECKPOINTS = [6, 12, 24];

export interface CrossAnalysis {
  kAnonMin: number;
  minSample: number;
  /** 1) 소속 × 선지급률 — 분포 */
  advanceByTier: Record<string, Distribution>;
  /** 2) 소속 × 환수 구간 — 6/12/24 점검점 중앙값 (핵심 축적 데이터) */
  clawbackByTier: Record<string, { n: number; blocked: boolean; masked: boolean; checkpoints: Record<number, number | null> }>;
  /** 3) 소속 × 상품 — 카운트 (k-익명성 셀 차단) */
  productByTier: Record<string, Record<string, number | null>>;
  /** 4) 상품 × 환수 — 상품별 6/12/24 중앙값 */
  clawbackByProduct: Record<string, { n: number; blocked: boolean; masked: boolean; checkpoints: Record<number, number | null> }>;
  /** 5) 회사 최소치 유무 × 소속 — 최소치 있는 비율 */
  minimumByTier: Record<string, { n: number; blocked: boolean; withMinimum: number | null }>;
  totalStructure: number;
  totalContract: number;
}

function clawbackAtCheckpoints(schedules: ClawbackBracket[][]): Record<number, number | null> {
  const out: Record<number, number | null> = {};
  for (const m of CHECKPOINTS) {
    const rates = schedules.map((s) => clawbackRateFor(m, s));
    out[m] = schedules.length >= K_ANON_MIN ? median(rates) : null;
  }
  return out;
}

export async function crossAnalysis(): Promise<CrossAnalysis> {
  const structure = (await loadAll<StructureRecord>('structure')).filter((r) => r.enteredBy === 'user');
  const contracts = (await loadAll<ContractStructureRecord>('contract')).filter((r) => r.enteredBy === 'user');

  const advanceByTier: CrossAnalysis['advanceByTier'] = {};
  const clawbackByTier: CrossAnalysis['clawbackByTier'] = {};
  const productByTier: CrossAnalysis['productByTier'] = {};
  const minimumByTier: CrossAnalysis['minimumByTier'] = {};

  for (const tier of TIERS) {
    const recs = structure.filter((r) => r.companyTier === tier);
    // 1) 선지급률 분포 (직접 입력값만)
    advanceByTier[tier] = distribution(recs.map((r) => r.advanceRate).filter((v): v is number => typeof v === 'number'));
    // 2) 환수 구간 점검점
    const schedules = recs.map((r) => r.clawbackSchedule).filter((v): v is ClawbackBracket[] => Array.isArray(v));
    clawbackByTier[tier] = {
      n: schedules.length,
      blocked: schedules.length < K_ANON_MIN,
      masked: schedules.length < STRUCTURE_MIN_SAMPLE,
      checkpoints: clawbackAtCheckpoints(schedules),
    };
    // 3) 상품 카운트 — 셀 k-익명성
    const byProd: Record<string, number | null> = {};
    const prodCount: Record<string, number> = {};
    for (const r of recs) prodCount[r.mainProductLine] = (prodCount[r.mainProductLine] ?? 0) + 1;
    for (const [prod, c] of Object.entries(prodCount)) byProd[prod] = c < K_ANON_MIN ? null : c;
    productByTier[tier] = byProd;
    // 5) 최소치 유무
    minimumByTier[tier] = {
      n: recs.length,
      blocked: recs.length < K_ANON_MIN,
      withMinimum: recs.length < K_ANON_MIN ? null : recs.filter((r) => r.hasCompanyMinimum).length,
    };
  }

  // 4) 상품 × 환수 — 상품별 환수 구간 (structure record의 mainProductLine 기준)
  const clawbackByProduct: CrossAnalysis['clawbackByProduct'] = {};
  const prods = [...new Set(structure.map((r) => r.mainProductLine))];
  for (const prod of prods) {
    const schedules = structure
      .filter((r) => r.mainProductLine === prod)
      .map((r) => r.clawbackSchedule)
      .filter((v): v is ClawbackBracket[] => Array.isArray(v));
    clawbackByProduct[prod] = {
      n: schedules.length,
      blocked: schedules.length < K_ANON_MIN,
      masked: schedules.length < STRUCTURE_MIN_SAMPLE,
      checkpoints: clawbackAtCheckpoints(schedules),
    };
  }

  return {
    kAnonMin: K_ANON_MIN,
    minSample: STRUCTURE_MIN_SAMPLE,
    advanceByTier,
    clawbackByTier,
    productByTier,
    clawbackByProduct,
    minimumByTier,
    totalStructure: structure.length,
    totalContract: contracts.length,
  };
}
