'use client';

/**
 * /contracts — 이번 달 계약 추가/삭제 (2026-08-13 화면 개편으로 대시보드에서 분리).
 * 환수 확률을 묻지 않는다 — 사실 4문항으로 위험을 판정한다 (PRD §8.1).
 * ⚠️ 계약자 실명 입력 금지 — 별칭만.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAccount } from '@/lib/account';
import { assessBusinessRisk, assessRisk, BUSINESS_CATEGORY_OPTIONS, DRIVER_LABEL, isBusinessRiskHigh, RISK_LEVEL_LABEL } from '@/lib/risk';
import { estimateAdvance, monthsHeld } from '@/lib/cashflow';
import { loadVaultContracts, saveVaultContracts } from '@/lib/vault';
import VaultGate from '@/components/VaultGate';
import { man, pct } from '@/lib/format';
import type { AgentProfile, Contract, ContractFactors, ProductLine } from '@/types';

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

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const EMPTY_FACTORS: ContractFactors = {
  relationship: 'referral',
  premiumBurden: 'adequate',
  motivation: 'customer-need',
  autoTransfer: true,
};

/** 금고 게이트 — 잠기면 Inner가 언마운트되어 메모리의 계약(금액) 상태가 해제된다 */
export default function ContractsPage() {
  return (
    <VaultGate>
      <ContractsInner />
    </VaultGate>
  );
}

function ContractsInner() {
  const { status, profile } = useAccount();
  const [contracts, setContracts] = useState<Contract[]>([]);

  const [label, setLabel] = useState('');
  const [premium, setPremium] = useState(0);
  const [product, setProduct] = useState<ProductLine>('third');
  const [contractMonth, setContractMonth] = useState(thisMonth());
  const [advancePaid, setAdvancePaid] = useState(0);
  const [businessCat, setBusinessCat] = useState<string>(''); // '' = 미입력(평균 추정), 'none' = 사업장 아님
  const [factors, setFactors] = useState<ContractFactors>({ ...EMPTY_FACTORS });

  useEffect(() => {
    if (status === 'ready') void loadVaultContracts().then(setContracts);
  }, [status]);

  const assessments = useMemo(() => contracts.map(assessRisk), [contracts]);

  if (status !== 'ready' || !profile) return null;

  function addContract() {
    if (!label.trim() || premium <= 0) return;
    const contract: Contract = {
      id: `c-${Date.now()}`,
      label: label.trim(),
      monthlyPremium: premium,
      advancePaid,
      productLine: product,
      contractMonth,
      factors: { ...factors },
      businessCategory: businessCat === '' ? undefined : businessCat,
      createdAt: new Date().toISOString(),
    };
    const next = [...contracts, contract];
    setContracts(next);
    void saveVaultContracts(next); // AES-GCM 암호문으로만 저장
    setLabel('');
    setPremium(0);
    setAdvancePaid(0);
    setBusinessCat('');
    setFactors({ ...EMPTY_FACTORS });
    setContractMonth(thisMonth());
  }

  function removeContract(id: string) {
    const next = contracts.filter((c) => c.id !== id);
    setContracts(next);
    void saveVaultContracts(next);
  }

  const choice = <T extends string>(
    options: { value: T; label: string }[],
    current: T,
    onPick: (v: T) => void,
  ) => (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onPick(o.value)}
          className={`rounded-full border px-3 py-1 text-xs ${
            current === o.value ? 'border-[#3182F6] bg-[#3182F6] text-white' : 'border-slate-300 hover:bg-slate-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">계약 관리</h1>
        <Link href="/dashboard" className="text-sm text-slate-500 underline hover:text-slate-700">
          ← 대시보드
        </Link>
      </div>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-bold">계약 추가</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1 text-xs text-slate-500">별칭 (실명 입력 금지 — 예: "카페 사장님")</p>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="별칭"
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-500">체결 연월</p>
            <input
              type="month"
              value={contractMonth}
              onChange={(e) => setContractMonth(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-500">월납보험료 (만원)</p>
            <input
              type="number"
              min={0}
              value={premium || ''}
              onChange={(e) => setPremium(Number(e.target.value) || 0)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm"
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-500">이번 달 선지급 수수료 (만원)</p>
            <input
              type="number"
              min={0}
              value={advancePaid || ''}
              onChange={(e) => setAdvancePaid(Number(e.target.value) || 0)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-sm"
            />
            {premium > 0 && (
              <button
                onClick={() => setAdvancePaid(estimateAdvance(premium, profile.advanceRate))}
                className="mt-1 text-xs text-sky-700 underline"
              >
                모름 → 추정치 {man(estimateAdvance(premium, profile.advanceRate))} 넣기 (1200% 상한 × 선지급률{' '}
                {pct(profile.advanceRate)} — 보수적 추정)
              </button>
            )}
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs text-slate-500">상품 구분</p>
          {choice(
            Object.entries(PRODUCT_LABEL).map(([value, l]) => ({ value: value as ProductLine, label: l })),
            product,
            setProduct,
          )}
        </div>

        <div>
          <p className="mb-1 text-xs text-slate-500">
            계약자 사업장 업종 (선택) — 사업장 존속 위험 판정에 사용됩니다
          </p>
          {choice(
            [
              ...BUSINESS_CATEGORY_OPTIONS.map((c) => ({ value: c, label: c })),
              { value: 'none', label: '사업장 아님' },
            ],
            businessCat,
            (v) => setBusinessCat(businessCat === v ? '' : v),
          )}
          {businessCat === '' && (
            <p className="mt-1 text-xs text-amber-700">
              미선택 시 지역 전체 평균 폐업률로 추정 적용됩니다. 사업장이 없는 계약이면 "사업장 아님"을 선택하세요.
            </p>
          )}
        </div>

        {/* 4문항 — 전부 사실 질문. 환수 확률을 묻지 않는다 */}
        <div className="space-y-3 rounded-lg bg-slate-50 p-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">① 계약자와의 관계</p>
            {choice(
              [
                { value: 'acquaintance' as const, label: '지인' },
                { value: 'referral' as const, label: '소개' },
                { value: 'cold' as const, label: '개척' },
              ],
              factors.relationship,
              (v) => setFactors({ ...factors, relationship: v }),
            )}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">② 보험료가 계약자 소득 대비</p>
            {choice(
              [
                { value: 'comfortable' as const, label: '여유' },
                { value: 'adequate' as const, label: '적정' },
                { value: 'tight' as const, label: '빠듯' },
              ],
              factors.premiumBurden,
              (v) => setFactors({ ...factors, premiumBurden: v }),
            )}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">③ 가입 계기</p>
            {choice(
              [
                { value: 'customer-need' as const, label: '계약자가 필요를 느껴서' },
                { value: 'my-request' as const, label: '내 부탁으로' },
              ],
              factors.motivation,
              (v) => setFactors({ ...factors, motivation: v }),
            )}
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-600">④ 자동이체 등록</p>
            {choice(
              [
                { value: 'yes' as const, label: '예' },
                { value: 'no' as const, label: '아니오' },
              ],
              factors.autoTransfer ? ('yes' as const) : ('no' as const),
              (v) => setFactors({ ...factors, autoTransfer: v === 'yes' }),
            )}
          </div>
        </div>

        <button
          onClick={addContract}
          disabled={!label.trim() || premium <= 0}
          className="w-full rounded-lg bg-[#3182F6] py-2 text-sm font-medium text-white hover:bg-[#1B64DA] disabled:bg-slate-300"
        >
          계약 추가
        </button>
      </section>

      <section>
        <h2 className="mb-2 font-bold">등록된 계약 {contracts.length}건</h2>
        {contracts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
            아직 등록된 계약이 없습니다.
          </p>
        ) : (
          <ul className="space-y-2">
            {contracts.map((c) => {
              const a = assessments.find((x) => x.contractId === c.id)!;
              const b = assessBusinessRisk(c);
              return (
                <li key={c.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${LEVEL_STYLE[a.level]}`}>
                        품질 {RISK_LEVEL_LABEL[a.level]}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                          b.source === 'none'
                            ? 'bg-slate-100 text-slate-500'
                            : isBusinessRiskHigh(b)
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-sky-100 text-sky-700'
                        }`}
                      >
                        {b.source === 'none'
                          ? '존속 해당없음'
                          : `존속 ${Math.round(b.closureProb24 * 100)}%${b.estimated ? '·추정' : ''}`}
                      </span>
                      <span className="font-medium">{c.label}</span>
                      <span className="text-xs text-slate-400">
                        {PRODUCT_LABEL[c.productLine]} · 월납 {man(c.monthlyPremium)} · 선지급 {man(c.advancePaid)} ·
                        유지 {monthsHeld(c.contractMonth)}개월
                      </span>
                    </div>
                    <button onClick={() => removeContract(c.id)} className="text-xs text-slate-400 hover:text-red-600">
                      삭제
                    </button>
                  </div>
                  {a.drivers.length > 0 && (
                    <p className="mt-1.5 text-xs text-slate-500">{a.drivers.map((d) => DRIVER_LABEL[d]).join(' · ')}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
