'use client';

/**
 * /settings — 정보 입력·수정 통합 화면 (2026-08-13 화면 개편, 구 온보딩 플로우 대체).
 * 최초 진입: 순서대로 안내. 재방문: 수정 화면.
 * 필수는 A(지역, 고정)·B(소속)·D(자금)뿐 — 나머지는 비워도 대시보드로 넘어갈 수 있다.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { logout, pushProfile, useAccount } from '@/lib/account';
import { CASHFLOW_DEFAULTS } from '@/config/cashflow-defaults';
import { STRUCTURE_PRESETS } from '@/config/structure-presets';
import { clearAll } from '@/lib/storage';
import VaultGate from '@/components/VaultGate';
import { man } from '@/lib/format';
import { SIDO_LIST, findRegion } from '@/data/regions';
import { fetchRegionRegistry, findPack, type RegionRegistry } from '@/lib/region-registry';
import StructureEditor, { SourceBadge } from '@/components/StructureEditor';
import type { AgentProfile, Affiliation, ClawbackBracket, ProductLine } from '@/types';

const DEFAULT_SIGUNGU = '11170'; // 서울 용산구 — 초기 선택값일 뿐, 활성 여부는 레지스트리가 결정

const TIER_OPTIONS: { value: AgentProfile['companyTier']; label: string; affiliation: Affiliation }[] = [
  { value: 'captive-life', label: '전속 (생보)', affiliation: 'captive' },
  { value: 'captive-nonlife', label: '전속 (손보)', affiliation: 'captive' },
  { value: 'large-ga', label: 'GA (대형)', affiliation: 'ga' },
  { value: 'small-ga', label: 'GA (중소)', affiliation: 'ga' },
];

const PRODUCT_OPTIONS: { value: ProductLine; label: string }[] = [
  { value: 'life', label: '생명' },
  { value: 'third', label: '제3보험 (건강·상해)' },
  { value: 'general', label: '손해 (일반)' },
  { value: 'auto', label: '자동차' },
  { value: 'savings', label: '저축성' },
];

function Section({
  code,
  title,
  required,
  children,
}: {
  code: string;
  title: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="mb-4 font-bold">
        <span className="mr-2 inline-block w-6 rounded bg-[#3182F6] text-center text-sm text-white">{code}</span>
        {title}
        {required ? (
          <span className="ml-2 text-xs font-normal text-red-500">필수</span>
        ) : (
          <span className="ml-2 text-xs font-normal text-slate-400">선택 — 비워도 됩니다</span>
        )}
      </h2>
      {children}
    </section>
  );
}

/** 금고 게이트 — 설정에는 금액 입력(D)이 있어 잠금 대상이다. 잠기면 Inner 언마운트. */
export default function SettingsPage() {
  return (
    <VaultGate>
      <SettingsInner />
    </VaultGate>
  );
}

function SettingsInner() {
  const router = useRouter();
  const account = useAccount(false); // 설정은 온보딩 화면 겸용 — noProfile이어도 여기 머문다
  const [isFirst, setIsFirst] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const [sido, setSido] = useState('11');
  const [sigungu, setSigungu] = useState(DEFAULT_SIGUNGU);
  const [registry, setRegistry] = useState<RegionRegistry>({ updatedAt: '', regions: [] });
  const [tier, setTier] = useState<AgentProfile['companyTier']>('large-ga');
  const [product, setProduct] = useState<ProductLine>('third');
  const [advanceRate, setAdvanceRate] = useState<number>(CASHFLOW_DEFAULTS.advanceRate);
  const [schedule, setSchedule] = useState<ClawbackBracket[]>(
    CASHFLOW_DEFAULTS.clawbackSchedule.map((b) => ({ ...b })),
  );
  const [source, setSource] = useState<AgentProfile['structureSource']>({
    advanceRate: 'default',
    clawbackSchedule: 'default',
  });
  const [avgCommission, setAvgCommission] = useState(0);
  const [cash, setCash] = useState(0);
  const [fixedExpense, setFixedExpense] = useState(0);
  const [expenseTouched, setExpenseTouched] = useState(false);
  const [goal, setGoal] = useState(0);
  const [companyMin, setCompanyMin] = useState(0);
  const [optIn, setOptIn] = useState(false); // 익명 집계 — 기본 OFF
  // 이메일 구독 — 계정과 분리된 시스템 (2026-08-14). 이메일만으로 등록하며 계정과 묶지 않는다.
  const [subEmail, setSubEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const [subBusy, setSubBusy] = useState(false);
  const [subMsg, setSubMsg] = useState('');

  useEffect(() => {
    if (account.status === 'loading') return;
    if (account.status === 'guest') {
      router.replace('/login');
      return;
    }
    fetchRegionRegistry().then(setRegistry);
    const existing = account.profile; // 서버가 단일 출처 (계정에 저장된 프로필)
    if (existing) {
      setIsFirst(false);
      const found = findRegion(existing.region);
      if (found) {
        setSido(found.sido.code);
        setSigungu(found.sigungu.code);
      }
      setTier(existing.companyTier);
      setProduct(existing.mainProductLine);
      setAdvanceRate(existing.advanceRate);
      setSchedule(existing.clawbackSchedule.map((b) => ({ ...b })));
      setSource(existing.structureSource);
      setAvgCommission(existing.avgCommission3m);
      setCash(existing.cashOnHand);
      setFixedExpense(existing.monthlyFixedExpense);
      setExpenseTouched(true);
      setGoal(existing.monthlyGoal);
      setCompanyMin(existing.companyMinimum);
      setOptIn(existing.optInAnonymousStats);
    }
    // 구독 상태 조회 — 편의상 계정 이메일을 기본값으로 채우지만 시스템적으로는 무관하다
    if (account.email) {
      setSubEmail(account.email);
      fetch(`/api/notify/subscribe?email=${encodeURIComponent(account.email)}`)
        .then((r) => r.json())
        .then((j) => setSubscribed(Boolean(j.subscribed)))
        .catch(() => {});
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.status]);

  const suggestedExpense = Math.round(avgCommission * CASHFLOW_DEFAULTS.fixedExpenseRatio);

  // 고정지출 기본값 제안 = 3개월 평균 × 70% (사용자가 건드리기 전까지 추종)
  useEffect(() => {
    if (!expenseTouched) setFixedExpense(suggestedExpense);
  }, [expenseTouched, suggestedExpense]);

  // B(소속) 선택 → C(구조) 프리셋 적용. 사용자가 직접 입력한('user') 값은 덮어쓰지 않는다.
  function pickTier(next: AgentProfile['companyTier']) {
    setTier(next);
    const preset = STRUCTURE_PRESETS[next];
    if (source.advanceRate === 'default') setAdvanceRate(preset.advanceRate);
    if (source.clawbackSchedule === 'default') setSchedule(preset.clawbackSchedule.map((b) => ({ ...b })));
  }

  const canSave = avgCommission > 0 && fixedExpense > 0;

  async function save() {
    const now = new Date().toISOString();
    const existing = account.profile;
    const profile: AgentProfile = {
      avgCommission3m: avgCommission,
      cashOnHand: cash,
      monthlyFixedExpense: fixedExpense,
      region: sigungu,
      affiliation: TIER_OPTIONS.find((t) => t.value === tier)!.affiliation,
      companyTier: tier,
      advanceRate,
      mainProductLine: product,
      monthlyGoal: goal,
      companyMinimum: companyMin,
      clawbackSchedule: schedule,
      structureSource: source,
      optInAnonymousStats: optIn,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await pushProfile(profile); // 서버가 단일 출처 — 평문 로컬 캐시 없음 (금고 도입)
    router.push('/dashboard');
  }

  async function handleLogout() {
    await logout();
    clearAll(); // 로컬 캐시(프로필·계약) 정리
    router.push('/');
  }

  function deleteAll() {
    if (window.confirm('이 브라우저에 저장된 내 정보와 계약을 전부 삭제합니다. 되돌릴 수 없습니다. 삭제할까요?')) {
      clearAll();
      router.push('/');
    }
  }

  if (!loaded) return null;

  const numInput = (value: number, onChange: (n: number) => void) => (
    <input
      type="number"
      min={0}
      value={value || ''}
      placeholder="0"
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-right focus:border-slate-500 focus:outline-none"
    />
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-bold">{isFirst ? '정보 입력' : '내 정보 수정'}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {isFirst
            ? '위에서부터 순서대로 내려가며 입력하세요. 필수는 A·B·D 세 개뿐이고, 나머지는 비워도 결과를 볼 수 있습니다.'
            : '수정할 항목만 바꾸고 저장하세요.'}
        </p>
      </div>

      <Section code="A" title="활동 지역" required>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="mb-1 text-xs text-slate-500">시/도</p>
            <select
              value={sido}
              onChange={(e) => {
                const nextSido = e.target.value;
                setSido(nextSido);
                const first = SIDO_LIST.find((s) => s.code === nextSido)?.sigungu[0];
                if (first) setSigungu(first.code);
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {SIDO_LIST.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-500">시/군/구</p>
            <select
              value={sigungu}
              onChange={(e) => setSigungu(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {(SIDO_LIST.find((s) => s.code === sido)?.sigungu ?? []).map((g) => (
                <option key={g.code} value={g.code}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-2 text-sm">
          {findPack(registry, sigungu) ? (
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
              접점 데이터 준비됨 · {findPack(registry, sigungu)!.recordCount.toLocaleString()}건
            </span>
          ) : (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
              데이터 준비 중
            </span>
          )}
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
            데이터가 준비되지 않은 지역을 선택하면 접점 리스트가 비어 있게 됩니다. 자금 구조 점검은 지역과 무관하게
            동작합니다.
          </p>
        </div>
      </Section>

      <Section code="B" title="소속 형태" required>
        <p className="mb-2 text-sm text-slate-500">
          회사명은 받지 않습니다. 이 선택은 C의 기본 프리셋을 결정하도록 설계돼 있지만, <b>현재는 4개 구분의 실측
          기준 데이터가 없어 모두 같은 예시값이 적용됩니다</b> — 익명 통계가 쌓이면 구분별로 분화됩니다.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {TIER_OPTIONS.map((t) => (
            <button
              key={t.value}
              onClick={() => pickTier(t.value)}
              className={`rounded-lg border px-3 py-2 text-sm ${
                tier === t.value ? 'border-[#3182F6] bg-[#3182F6] text-white' : 'border-slate-300 hover:bg-slate-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="mb-2 mt-4 text-sm text-slate-600">주력 상품</p>
        <div className="flex flex-wrap gap-2">
          {PRODUCT_OPTIONS.map((p) => (
            <button
              key={p.value}
              onClick={() => setProduct(p.value)}
              className={`rounded-full border px-3 py-1.5 text-sm ${
                product === p.value ? 'border-[#3182F6] bg-[#3182F6] text-white' : 'border-slate-300 hover:bg-slate-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Section>

      <Section code="C" title="수수료 구조">
        <StructureEditor
          advanceRate={advanceRate}
          schedule={schedule}
          source={source}
          onAdvanceRateChange={(v) => {
            setAdvanceRate(v);
            setSource((s) => ({ ...s, advanceRate: 'user' }));
          }}
          onScheduleChange={(s) => {
            setSchedule(s);
            setSource((prev) => ({ ...prev, clawbackSchedule: 'user' }));
          }}
        />
      </Section>

      <Section code="D" title="자금" required>
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-sm text-slate-600">지난 3개월 수수료 수령액 평균 (만원)</p>
            {numInput(avgCommission, setAvgCommission)}
          </div>
          <div>
            <p className="mb-1 text-sm text-slate-600">현재 보유 현금 — 대략이면 됩니다 (만원)</p>
            {numInput(cash, setCash)}
          </div>
          <div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-600">월 고정지출 — 월세·대출·생활비 포함 (만원)</p>
              {suggestedExpense > 0 && fixedExpense === suggestedExpense && !expenseTouched ? (
                <SourceBadge source="default" />
              ) : (
                fixedExpense > 0 && <SourceBadge source="user" />
              )}
            </div>
            {suggestedExpense > 0 && (
              <p className="mt-0.5 text-xs text-slate-400">
                모르면 3개월 평균의 70%인 {man(suggestedExpense)}부터 시작해 조정하세요.
              </p>
            )}
            <div className="mt-2 text-center text-2xl font-bold">{man(fixedExpense)}</div>
            <input
              type="range"
              min={0}
              max={Math.max(1000, Math.round(avgCommission * 1.5))}
              step={5}
              value={fixedExpense}
              onChange={(e) => {
                setFixedExpense(Number(e.target.value));
                setExpenseTouched(true);
              }}
              className="w-full accent-[#3182F6]"
            />
          </div>
        </div>
      </Section>

      <Section code="E" title="회사 목표">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-sm text-slate-600">이번 달 내 목표 (만원)</p>
            {numInput(goal, setGoal)}
          </div>
          <div>
            <p className="mb-1 text-sm text-slate-600">회사 권장 최소치 (만원)</p>
            {numInput(companyMin, setCompanyMin)}
          </div>
        </div>
        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
          회사 최소치를 입력하면 대시보드에서 회사 요구와 내 재무 안전이 충돌하는 지점을 확인할 수 있습니다. 최소치를
          맞추려 무리하게 넣은 계약은 그 자체가 환수 위험이 됩니다.
        </p>
      </Section>

      <Section code="F" title="데이터">
        <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm">
          <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} className="mt-0.5" />
          <span className="text-slate-600">
            익명 통계에 참여합니다 (선택). 소속 형태·상품 구분과 <b>내가 직접 입력한</b> 선지급률·환수 구간 설정만
            익명으로 집계됩니다. 기본값을 그대로 쓰는 동안에는 구조값이 집계되지 않습니다.
          </span>
        </label>
        <div className="mt-4 space-y-2 rounded-lg border border-slate-200 p-3">
          <p className="text-sm font-medium text-slate-700">오늘의 접점 메일 구독</p>
          <p className="text-xs text-slate-500">
            매일 오전 10시, 선택한 지역({findRegion(sigungu)?.sigungu.name ?? sigungu})의 오늘 가볼 접점 상위 5곳을
            보냅니다. 접점 정보만 발송되며 계약·금액 데이터는 포함되지 않습니다. <b>구독은 계정과 분리된 시스템</b>이라
            로그인 없이도 이메일만으로 등록·해제됩니다.
          </p>
          <div className="flex gap-2">
            <input
              type="email"
              value={subEmail}
              onChange={(e) => setSubEmail(e.target.value)}
              placeholder="받을 이메일"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
            <button
              onClick={async () => {
                setSubBusy(true);
                setSubMsg('');
                try {
                  if (subscribed) {
                    await fetch(`/api/notify/unsubscribe?email=${encodeURIComponent(subEmail)}`);
                    setSubscribed(false);
                    setSubMsg('구독이 해제되었습니다.');
                  } else {
                    const r = await fetch('/api/notify/subscribe', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email: subEmail, region: sigungu }),
                    });
                    const j = await r.json();
                    if (r.ok) {
                      setSubscribed(true);
                      setSubMsg('구독되었습니다. 메일 하단 링크로 언제든 해제할 수 있습니다.');
                    } else {
                      setSubMsg(j.message ?? '등록 실패');
                    }
                  }
                } catch {
                  setSubMsg('네트워크 오류');
                }
                setSubBusy(false);
              }}
              disabled={subBusy || !subEmail}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300 ${subscribed ? 'bg-slate-500' : 'bg-[#3182F6]'}`}
            >
              {subscribed ? '구독 해제' : '구독'}
            </button>
          </div>
          {subMsg && <p className="text-xs text-slate-500">{subMsg}</p>}
        </div>
        <div className="mt-3 flex items-center gap-4">
          <button onClick={handleLogout} className="text-sm text-slate-500 underline hover:text-slate-700">
            로그아웃
          </button>
          <button onClick={deleteAll} className="text-sm text-red-600 underline hover:text-red-700">
            내 데이터 전체 삭제
          </button>
        </div>
      </Section>

      <div className="sticky bottom-0 border-t border-slate-200 bg-slate-50/95 py-3 backdrop-blur">
        <button
          onClick={save}
          disabled={!canSave}
          className="w-full rounded-2xl bg-[#3182F6] py-3 font-medium text-white transition hover:bg-[#1B64DA] disabled:bg-slate-300"
        >
          {canSave ? '저장하고 대시보드 보기' : 'D 섹션(3개월 평균·월 고정지출)을 채우면 저장할 수 있습니다'}
        </button>
      </div>
    </div>
  );
}
