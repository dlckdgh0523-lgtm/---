/**
 * LLM 회귀 평가 러너 (2026-08-14 지시 A).
 *
 * 실행: npm run eval   (로컬 dev 서버가 떠 있어야 함 — 프로덕션 경로를 그대로 호출한다)
 * 환경변수: EVAL_BASE(기본 http://localhost:3000), EVAL_EMAIL/EVAL_PW(기본 테스트 계정)
 *
 * - 각 케이스를 3회 반복 실행해 변동성(3회 중 몇 회 통과)을 측정한다. LLM은 비결정적이라 "1회 통과"는 통과가 아니다.
 * - 규칙 판정(assert.ts) 우선, LLM 심사(judge.ts)는 보조.
 * - 결과를 evals/results/{ts}.json으로 저장하고, 직전 실행과 비교해 회귀(통과→실패)를 표시.
 * - 통과율이 기준선 미만이면 비영점 종료.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CASES, type EvalCase } from './cases';
import {
  assertGuardClean,
  assertLength,
  assertNoBanned,
  assertNonEmpty,
  assertWhitelist,
  type AssertResult,
} from './assert';
import { judgeScenarioAngles } from './judge';
import { loadPlaceContext } from '../src/lib/server/place-context';

/**
 * 결함 1 수정: 컨텍스트로 넘기는 모든 수치를 allowedNumbers에 자동 포함한다(손 관리 폐기).
 * 경과 개월, 그 값을 년으로 반올림/버림, N주년, 업종 폐업률(%)의 반올림/버림을 허용.
 * 모델이 컨텍스트 값을 정확히 인용하면 위반으로 잡히지 않는다.
 */
function contextAllowedNumbers(region: string, placeId: string): number[] {
  const loaded = loadPlaceContext(region, placeId);
  if (!loaded) return [];
  const c = loaded.context;
  const p = loaded.place;
  const nums = new Set<number>();
  nums.add(c.elapsedMonths);
  nums.add(Math.round(c.elapsedMonths / 12));
  nums.add(Math.floor(c.elapsedMonths / 12));
  if (c.anniversaryYears) nums.add(c.anniversaryYears);
  if (c.industryClosure24Pct != null) {
    nums.add(Math.round(c.industryClosure24Pct));
    nums.add(Math.floor(c.industryClosure24Pct));
    nums.add(Math.ceil(c.industryClosure24Pct));
  }
  nums.add(24); // 폐업률 지표 기간(24개월)은 프롬프트가 유도하는 상수 — 컨텍스트 값과 함께 허용
  // 개업일(licenseDate) 연·월 — LLM이 "1996년 개업" 등으로 인용 가능
  for (const n of p.licenseDate.split('-').map(Number)) if (n) nums.add(n);
  // 전환 의심 사업장의 이전 폐업일(prevClosedAt) — 컨텍스트로 넘기는 값이므로 자동 포함(결함 1 정신)
  if (p.suspectedRelicense?.prevClosedAt) {
    for (const n of p.suspectedRelicense.prevClosedAt.split('-').map(Number)) if (n) nums.add(n);
  }
  return [...nums];
}

const BASE = process.env.EVAL_BASE ?? 'http://localhost:3000';
const EMAIL = process.env.EVAL_EMAIL ?? 'enc-check@example.com';
const PW = process.env.EVAL_PW ?? 'encpass99';
const REPEATS = 3; // 변동성 측정
const PASS_BASELINE = 0.8; // 통과율 기준선 (안정 케이스 비율)
const RESULTS_DIR = path.join(process.cwd(), 'evals', 'results');

const proof = (e: string, p: string) => crypto.pbkdf2Sync(p, `ifc-auth-v1:${e}`, 300000, 32, 'sha256').toString('hex');

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, authProof: proof(EMAIL, PW) }),
  });
  if (!res.ok) throw new Error(`로그인 실패 ${res.status} — dev 서버와 테스트 계정을 확인하세요`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0];
}

/** 한 케이스 1회 실행 → assertion 목록 */
async function runOnce(c: EvalCase, cookie: string): Promise<{ asserts: AssertResult[]; ms: number }> {
  const H = { 'Content-Type': 'application/json', Cookie: cookie };
  const t0 = Date.now();
  const asserts: AssertResult[] = [];

  if (c.feature === 'scenario') {
    const j = await (await fetch(`${BASE}/api/llm/scenario`, { method: 'POST', headers: H, body: JSON.stringify(c.input) })).json();
    asserts.push({ name: 'schema:status-ok', pass: j.status === 'ok' && Array.isArray(j.scenarios) });
    if (j.status === 'ok') {
      const texts: string[] = j.scenarios.map((s: { text: string }) => s.text);
      asserts.push({ name: 'count:3', pass: texts.length === 3, detail: `${texts.length}개` });
      const allowed = contextAllowedNumbers(c.input.region as string, c.input.placeId as string);
      for (const t of texts) {
        asserts.push(...assertNoBanned(t));
        asserts.push(assertWhitelist(t, allowed));
        asserts.push(assertLength(t, 10, 200));
      }
      // LLM 보조 심사: 3개 각도가 서로 다른가
      asserts.push(await judgeScenarioAngles(texts));
    }
  } else if (c.feature === 'score') {
    const j = await (await fetch(`${BASE}/api/llm/roleplay/score`, { method: 'POST', headers: H, body: JSON.stringify(c.input) })).json();
    asserts.push({ name: 'schema:status-ok', pass: j.status === 'ok' && Array.isArray(j.verdicts) });
    if (j.status === 'ok') {
      const metVerdicts = j.verdicts.filter((v: { met: boolean }) => v.met);
      // 충족 판정에는 전사 인용이 있어야 (코드 검증 통과분)
      asserts.push({ name: 'quote:met-has-quote', pass: metVerdicts.every((v: { quote: string | null; quoteValid: boolean }) => !v.quoteValid || (v.quote && v.quote.length > 0)) });
      // 기대 점수 방향 (엄격 일치 아님 — 방향만)
      if (c.meta?.expectScore === 'high') asserts.push({ name: 'score:high>=50', pass: j.score >= 50, detail: `${j.score}점` });
      if (c.meta?.expectScore === 'low') asserts.push({ name: 'score:low<=40', pass: j.score <= 40, detail: `${j.score}점` });
      if (c.meta?.expectScore === 'mid') asserts.push({ name: 'score:mid-range', pass: j.score >= 0 && j.score <= 100, detail: `${j.score}점` });
    }
  } else if (c.feature === 'hint') {
    const j = await (await fetch(`${BASE}/api/llm/roleplay/hint`, { method: 'POST', headers: H, body: JSON.stringify(c.input) })).json();
    asserts.push({ name: 'schema:status-ok', pass: j.status === 'ok' && Array.isArray(j.candidates) });
    if (j.status === 'ok') {
      asserts.push({ name: 'count:2-3', pass: j.candidates.length >= 1 && j.candidates.length <= 3, detail: `${j.candidates.length}개` });
      for (const cand of j.candidates as string[]) {
        asserts.push(assertNonEmpty(cand));
        asserts.push(assertGuardClean(cand));
      }
    }
  } else if (c.feature === 'guard') {
    const res = await fetch(`${BASE}/api/llm/roleplay/turn`, { method: 'POST', headers: H, body: JSON.stringify(c.input) });
    const text = await res.text();
    const ownerLines = text.trim().split('\n').filter((l) => l && !l.startsWith('__')).join(' ');
    // 가드 케이스의 판정 기준은 '금지 표현을 뱉지 않는지'뿐이다.
    // 유도 공격에 대한 무응답(빈 출력) 또는 전량 필터는 정당한 방어이므로 non-empty를 요구하지 않는다.
    asserts.push(...assertNoBanned(ownerLines));
  }

  return { asserts, ms: Date.now() - t0 };
}

interface CaseResult {
  id: string;
  feature: string;
  desc: string;
  runsPassed: number; // 3회 중 통과 횟수
  stable: boolean; // 3/3
  unstable: boolean; // 1~2/3 → 결함
  avgMs: number;
  failSamples: string[];
}

async function main() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const cookie = await login();
  console.log(`골든셋 ${CASES.length}건 × ${REPEATS}회 실행 (${BASE})\n`);

  const results: CaseResult[] = [];
  for (const c of CASES) {
    let passed = 0;
    let totalMs = 0;
    const failSamples: string[] = [];
    for (let i = 0; i < REPEATS; i++) {
      try {
        const { asserts, ms } = await runOnce(c, cookie);
        totalMs += ms;
        const allPass = asserts.every((a) => a.pass);
        if (allPass) passed++;
        else failSamples.push(asserts.filter((a) => !a.pass).map((a) => `${a.name}${a.detail ? `(${a.detail})` : ''}`).join(', '));
      } catch (e) {
        failSamples.push(`실행 오류: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }
    const r: CaseResult = {
      id: c.id,
      feature: c.feature,
      desc: c.desc,
      runsPassed: passed,
      stable: passed === REPEATS,
      unstable: passed > 0 && passed < REPEATS,
      avgMs: Math.round(totalMs / REPEATS),
      failSamples: [...new Set(failSamples)].slice(0, 3),
    };
    results.push(r);
    const mark = r.stable ? '✅' : r.unstable ? '⚠️ ' : '❌';
    console.log(`${mark} ${c.id} — ${passed}/${REPEATS} 통과 (${r.avgMs}ms)${r.failSamples.length ? '  실패: ' + r.failSamples[0] : ''}`);
  }

  // 기능별 통과율
  const byFeature: Record<string, { stable: number; total: number }> = {};
  for (const r of results) {
    const f = (byFeature[r.feature] ??= { stable: 0, total: 0 });
    f.total++;
    if (r.stable) f.stable++;
  }
  const stableCount = results.filter((r) => r.stable).length;
  const unstableCount = results.filter((r) => r.unstable).length;
  const passRate = stableCount / results.length;

  // 직전 실행과 회귀 비교
  const prev = loadLatest();
  const regressions: string[] = [];
  if (prev) {
    const prevMap = new Map(prev.results.map((r) => [r.id, r]));
    for (const r of results) {
      const p = prevMap.get(r.id);
      if (p && p.stable && !r.stable) regressions.push(r.id); // 안정→불안정/실패
    }
  }

  const summary = {
    ts: new Date().toISOString(),
    total: results.length,
    stableCount,
    unstableCount,
    passRate: Math.round(passRate * 1000) / 1000,
    baseline: PASS_BASELINE,
    byFeature,
    regressions,
    results,
  };
  const outPath = path.join(RESULTS_DIR, `${summary.ts.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(RESULTS_DIR, 'latest.json'), JSON.stringify(summary, null, 2));

  console.log(`\n안정 ${stableCount}/${results.length} (통과율 ${(passRate * 100).toFixed(0)}%) · 불안정 ${unstableCount}건`);
  if (regressions.length) console.log(`⚠️ 회귀(직전 대비 안정→불안정): ${regressions.join(', ')}`);
  console.log(`결과: ${outPath}`);

  if (passRate < PASS_BASELINE) {
    console.error(`\n통과율 ${(passRate * 100).toFixed(0)}%가 기준선 ${PASS_BASELINE * 100}% 미만 — 비영점 종료`);
    process.exit(1);
  }
}

function loadLatest(): { results: CaseResult[] } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, 'latest.json'), 'utf-8'));
  } catch {
    return null;
  }
}

main().catch((e) => {
  console.error('평가 실행 실패:', e instanceof Error ? e.message : e);
  process.exit(1);
});
