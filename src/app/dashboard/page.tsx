'use client';

/**
 * /dashboard — 결과 전용 화면 (2026-08-13 화면 개편).
 * ⚠️ 입력 폼을 하나도 두지 않는다. 계약 추가/수정은 /contracts, 조건 수정은 /settings.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAccount } from '@/lib/account';
import { assessBusinessRisk, assessRisk, DRIVER_LABEL, isBusinessRiskHigh, RISK_LEVEL_LABEL } from '@/lib/risk';
import { calcCashflow, monthsHeld } from '@/lib/cashflow';
import { loadContracts } from '@/lib/storage';
import { man } from '@/lib/format';
import { regionLabel } from '@/data/regions';
import { fetchRegionRegistry, findPack, type RegionRegistry } from '@/lib/region-registry';
import { pickTodayContacts, type TodayPick } from '@/lib/today-picks';
import { GROUPS } from '@/lib/place-view';
import type { AgentProfile, Contract, Place, ProductLine } from '@/types';

const PRODUCT_LABEL: Record<ProductLine, string> = {
  life: '생명',
  third: '제3보험',
  general: '손해(일반)',
  auto: '자동차',
  savings: '저축성',
};

const LEVEL_STYLE = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-emerald-100 text-emerald-700',
} as const;

export default function DashboardPage() {
  const { status, profile } = useAccount(); // guest→/login, 온보딩 전→/settings 자동 이동
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [registry, setRegistry] = useState<RegionRegistry>({ updatedAt: '', regions: [] });
  const [places, setPlaces] = useState<Place[]>([]);
  const [todayCat, setTodayCat] = useState(''); // 오늘 가볼 곳 업종 필터 ('' = 전체)

  useEffect(() => {
    if (status !== 'ready' || !profile) return;
    setContracts(loadContracts());
    (async () => {
      const reg = await fetchRegionRegistry();
      setRegistry(reg);
      if (findPack(reg, profile.region)) {
        try {
          const res = await fetch(`/data/regions/${profile.region}/places.json`);
          if (res.ok) setPlaces((await res.json()) as Place[]);
        } catch {
          /* 접점 데이터 실패는 대시보드를 막지 않음 */
        }
      }
    })();
  }, [status, profile]);

  // "오늘 가볼 곳" — 메일 발송과 동일한 선정 함수 + 업종 필터 (2026-08-14 피드백)
  const todayPicks = useMemo(
    () => pickTodayContacts(places, new Date(), 5, todayCat || undefined),
    [places, todayCat],
  );
  const todayCats = useMemo(
    () => [...new Set(pickTodayContacts(places, new Date(), 9999).map((p) => p.category))].sort(),
    [places],
  );

  const assessments = useMemo(() => contracts.map(assessRisk), [contracts]);
  const result = useMemo(
    () => (profile ? calcCashflow(profile, contracts, assessments) : null),
    [profile, contracts, assessments],
  );

  if (status !== 'ready' || !profile || !result) return null;

  const usingDefaults =
    profile.structureSource.advanceRate === 'default' || profile.structureSource.clawbackSchedule === 'default';
  const riskyContracts = contracts
    .map((c) => ({ contract: c, assessment: assessments.find((a) => a.contractId === c.id)! }))
    .sort((a, b) => b.assessment.score - a.assessment.score);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* 기본값 상태 배너 — 무엇이 기본값인지 명확히 (선지급률·환수 구간만 해당, 자금 입력과 무관) */}
      {usingDefaults && (
        <div className="flex items-center justify-between rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <span>수수료 구조(선지급률·환수 구간)가 업계 기본값이라 결과가 추정치입니다.</span>
          <Link href="/settings" className="font-medium underline">
            내 조건 입력 →
          </Link>
        </div>
      )}

      {/* 오늘 가볼 곳 — 메일과 같은 선정 함수 결과 (메일을 안 받아도 같은 가치) */}
      {places.length > 0 && (
        <section className="rounded-2xl border border-[#F2F4F6] bg-white p-5 shadow-[0_8px_24px_rgba(25,31,40,0.05)]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">오늘 가볼 곳</h2>
            <Link href="/places" className="text-sm text-[#3182F6] hover:underline">지도에서 보기 →</Link>
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <button
              onClick={() => setTodayCat('')}
              className={`rounded-full border px-3 py-1 text-xs ${todayCat === '' ? 'border-[#3182F6] bg-[#3182F6] text-white' : 'border-slate-300 hover:bg-slate-50'}`}
            >
              전체
            </button>
            {todayCats.map((c) => (
              <button
                key={c}
                onClick={() => setTodayCat(todayCat === c ? '' : c)}
                className={`rounded-full border px-3 py-1 text-xs ${todayCat === c ? 'border-[#3182F6] bg-[#3182F6] text-white' : 'border-slate-300 hover:bg-slate-50'}`}
              >
                {c}
              </button>
            ))}
          </div>
          {todayPicks.length === 0 && (
            <p className="rounded-xl bg-[#F9FAFB] p-3 text-sm text-slate-500">
              이 업종에는 오늘 우선 접촉·주년·전환 의심 대상이 없습니다.
            </p>
          )}
          <ul className="space-y-1.5">
            {todayPicks.map((pick, i) => (
              <li key={pick.placeId} className="flex items-center justify-between gap-2 rounded-2xl bg-[#F9FAFB] px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: GROUPS.find((g) => g.key === pick.group)!.color }}
                  />
                  <b>{i + 1}. {pick.name}</b>{' '}
                  <span className="text-xs text-slate-400">{pick.category} · {pick.groupLabel}{pick.anniversary ? ` ${pick.anniversary}주년` : ''}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-500">
                  업종 폐업률 {Math.round(pick.industryClosure24 * 100)}%{pick.closureSource === 'average' ? '·추정' : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">
            우선 접촉·주년 도래·전환 의심 중 업종 존속 위험이 낮은 순 상위 5곳 — 설정에서 메일로도 받을 수 있습니다.
          </p>
        </section>
      )}

      {/* 상단 히어로 — "몇 개월 버틴다"가 아니라 "환수 대비 얼마를 남겨둬야 하는가" 중심 (2026-08-14 피드백) */}
      {contracts.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-[#191F28] p-6 text-center text-white">
          <p className="text-sm text-slate-300">이번 달 수령액 중 아직 확정이 아니라서, 환수·세금 대비로</p>
          <p className="my-2 text-6xl font-bold tabular-nums">
            {result.recommendedReserve.toLocaleString('ko-KR')}
            <span className="text-2xl font-normal text-slate-300"> 만원</span>
          </p>
          <p className="text-sm text-slate-300">
            은 가지고 있어야 합니다 <span className="text-slate-500">(환수 노출 {man(result.clawbackExposed)} + 세금
            유보 {man(result.taxReserve)})</span>
          </p>
          <p className="mt-3 border-t border-white/10 pt-3 text-sm text-slate-400">
            이 유보액과 보유 현금이면 수입이 끊겨도 <b className="text-white">{result.runwayMonths.toFixed(1)}개월</b>{' '}
            버팁니다 (월 고정지출 {man(profile.monthlyFixedExpense)} 기준)
          </p>
        </section>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-[#191F28] p-6 text-center text-white">
          <p className="text-sm text-slate-300">보유 현금 기준, 지금 수입이 끊겨도</p>
          <p className="my-2 text-6xl font-bold tabular-nums">
            {result.runwayMonths.toFixed(1)}
            <span className="text-2xl font-normal text-slate-300"> 개월</span>
          </p>
          <p className="text-sm text-slate-300">
            버틸 수 있습니다 (월 고정지출 {man(profile.monthlyFixedExpense)} 기준) — 계약을 등록하면 환수 대비로
            남겨둘 몫이 계산됩니다
          </p>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-bold">이번 달 수령액 구조</h2>
        {contracts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
            이번 달 계약을 등록하면 수령액 중 환수에 노출된 몫이 계산됩니다.{' '}
            <Link href="/contracts" className="font-medium text-slate-700 underline">
              계약 등록하기 →
            </Link>
          </p>
        ) : (
          <>
            <div className="space-y-1.5 font-mono text-sm tabular-nums">
              <div className="flex justify-between">
                <span>이번 달 수령액</span>
                <b>{man(result.monthReceived)}</b>
              </div>
              <div className="flex justify-between pl-3 text-emerald-700">
                <span>├ 확정 몫</span>
                <span>{man(result.securedPortion)}</span>
              </div>
              <div className="flex justify-between pl-3 text-red-600">
                <span>
                  ├ 환수 노출 몫{' '}
                  <span className="text-xs">
                    ← 품질 상 {result.highRiskCount}건 · 존속 고위험 {result.businessHighCount}건
                  </span>
                </span>
                <span>{man(result.clawbackExposed)}</span>
              </div>
              <div className="flex justify-between pl-3 text-slate-500">
                <span>└ 세금·사업소득 유보 (10%)</span>
                <span>{man(result.taxReserve)}</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-slate-200 pt-2">
                <span>권장 유보액</span>
                <b>{man(result.recommendedReserve)}</b>
              </div>
              <div className="flex justify-between">
                <span>이번 달 실제 가처분</span>
                <b className={result.disposable < 0 ? 'text-red-600' : ''}>{man(result.disposable)}</b>
              </div>
            </div>

            {result.clawbackExposed > 0 && (
              <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm leading-relaxed text-red-800">
                <b>{man(result.clawbackExposed)}은 아직 확정된 돈이 아닙니다.</b> 지금 쓰면 환수가 걸렸을 때 대출로
                메워야 합니다. 두 위험은 성격이 다릅니다 — 품질은 이 계약이 유지될지(계약자 요인), 존속은 계약자의
                사업장이 살아남을지(구조적 요인)입니다.
              </p>
            )}
            {result.estimatedBusinessCount > 0 && (
              <p className="mt-2 text-xs text-slate-400">
                업종 미입력 {result.estimatedBusinessCount}건은 지역 전체 평균 폐업률로 추정 적용됐습니다.{' '}
                <Link href="/contracts" className="underline">계약에서 업종을 입력</Link>하면 정확해집니다.
              </p>
            )}

            {profile.companyMinimum > 0 ? (
              result.companyMinimumConflict && (
                <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm leading-relaxed text-amber-800">
                  이번 달 수령액이 회사 권장 최소치({man(profile.companyMinimum)})에 못 미칩니다. 최소치를 맞추기 위해
                  무리하게 넣는 계약은 그 자체가 환수 위험이 됩니다 — 숫자를 채우는 계약과 유지되는 계약은 다릅니다.
                </p>
              )
            ) : (
              <p className="mt-2 text-xs text-slate-400">
                회사 최소치를 입력하면 목표와 재무 안전의 충돌을 확인할 수 있습니다.{' '}
                <Link href="/settings" className="underline">
                  설정에서 입력 →
                </Link>
              </p>
            )}
          </>
        )}
      </section>

      {/* 중단: 위험 계약 목록 (읽기 전용) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">계약별 위험 판정</h2>
          <Link href="/contracts" className="text-sm text-slate-500 underline hover:text-slate-700">
            계약 관리 →
          </Link>
        </div>
        {riskyContracts.length === 0 ? (
          <p className="text-sm text-slate-400">등록된 계약이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {riskyContracts.map(({ contract, assessment }) => {
              const business = assessBusinessRisk(contract);
              return (
              <li key={contract.id} className="rounded-lg border border-slate-100 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${LEVEL_STYLE[assessment.level]}`}>
                    품질 {RISK_LEVEL_LABEL[assessment.level]}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                      business.source === 'none'
                        ? 'bg-slate-100 text-slate-500'
                        : isBusinessRiskHigh(business)
                          ? 'bg-orange-100 text-orange-700'
                          : 'bg-sky-100 text-sky-700'
                    }`}
                  >
                    {business.source === 'none'
                      ? '존속 해당없음'
                      : `존속 ${Math.round(business.closureProb24 * 100)}%${business.estimated ? '·추정' : ''}`}
                  </span>
                  <span className="text-sm font-medium">{contract.label}</span>
                  <span className="text-xs text-slate-400">
                    {PRODUCT_LABEL[contract.productLine]} · 월납 {man(contract.monthlyPremium)} · 유지{' '}
                    {monthsHeld(contract.contractMonth)}개월
                  </span>
                </div>
                {assessment.drivers.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    {assessment.drivers.map((d) => DRIVER_LABEL[d]).join(' · ')}
                  </p>
                )}
              </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 하단: 접점 리스트 진입 카드 — 활성 여부는 레지스트리(regions/index.json)가 결정 */}
      <Link href="/places" className="block rounded-2xl border border-slate-200 bg-white p-5 transition hover:bg-slate-50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold">{regionLabel(profile.region)} 접점 리스트</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {findPack(registry, profile.region)
                ? `개업 후 경과 개월 기준으로 오늘 가볼 사업장을 고릅니다 — ${findPack(registry, profile.region)!.recordCount.toLocaleString()}개 사업장 준비됨`
                : '이 지역의 접점 데이터가 아직 준비되지 않아 리스트가 비어 있습니다.'}
            </p>
          </div>
          {findPack(registry, profile.region) ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs text-emerald-800">준비됨 →</span>
          ) : (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">준비 중</span>
          )}
        </div>
      </Link>

      <p className="text-xs leading-relaxed text-slate-400">
        본 계산기는 수수료 구조를 이해하기 위한 시뮬레이션이며, 실제 환수 조건은 소속사 및 상품별 계약 내용에
        따릅니다. 재무 조언이 아닙니다. 위험 판정 가중치와 환수 구간 기본값은 미검증 가설·예시값입니다.
      </p>
    </div>
  );
}
