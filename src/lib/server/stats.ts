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
