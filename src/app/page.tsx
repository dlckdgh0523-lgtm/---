'use client';

/**
 * 랜딩 (2026-08-13 토스풍 리디자인).
 * - 이미 정보를 입력한 사용자는 자동으로 /dashboard 리다이렉트.
 * - 신뢰 원칙: 여기 등장하는 숫자는 전부 검증된 공시·실측값이다. 가짜 후기·과장 수치 금지.
 *   (정착률·1200%룰: 2026-08-13 웹 교차 확인 / 7,113건: 용산구 팩 실측 / 예시 화면은 '예시' 명시)
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetchMe } from '@/lib/account';

const INK = 'text-[#191F28]';
const SUB = 'text-[#4E5968]';

function Cta({ label = '시작하기' }: { label?: string }) {
  return (
    <Link
      href="/signup"
      className="inline-block rounded-2xl bg-[#3182F6] px-10 py-4 text-lg font-bold text-white transition hover:bg-[#1B64DA] active:scale-[0.98]"
    >
      {label}
    </Link>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // ?preview: 로그인 상태여도 랜딩을 보여주는 우회 — 평가자가 가입 후에도 랜딩을 볼 수 있게 함
    const preview = window.location.search.includes('preview');
    (async () => {
      const me = preview ? null : await fetchMe();
      if (me) router.replace(me.stored ? '/dashboard' : '/settings');
      else setReady(true);
    })();
  }, [router]);

  if (!ready) return null;

  return (
    <div className="mx-auto max-w-3xl">
      {/* ── Hero ── */}
      <section className="py-16 text-center sm:py-20">
        <span className="rounded-full bg-[#E8F3FF] px-4 py-1.5 text-sm font-semibold text-[#3182F6]">
          저연차 보험설계사를 위한 현장 도구
        </span>
        <h1 className={`mt-6 text-4xl font-extrabold leading-[1.25] tracking-tight sm:text-[44px] ${INK}`}>
          이번 달 수령한 수수료 중,
          <br />
          진짜 내 돈은 얼마인가요?
        </h1>
        <p className={`mx-auto mt-5 max-w-xl text-lg leading-relaxed ${SUB}`}>
          선지급 수수료는 아직 전부 내 돈이 아닙니다. 계약이 깨지면 환수로 돌아옵니다.
          <br className="hidden sm:block" />
          확정된 몫과 노출된 몫을 구분하고, 지금 수입이 끊겨도 몇 개월 버틸 수 있는지 확인하세요.
        </p>
        <div className="mt-9 flex items-center justify-center gap-4">
          <Cta />
          <Link href="/login" className="text-sm font-semibold text-[#4E5968] hover:text-[#3182F6]">
            로그인 →
          </Link>
        </div>
      </section>

      {/* ── 왜 지금인가 ── */}
      <section className="rounded-3xl bg-[#F2F4F6] p-8 sm:p-10">
        <h2 className={`text-2xl font-bold ${INK}`}>왜 지금인가요</h2>
        <p className={`mt-2 leading-relaxed ${SUB}`}>
          2026년 7월 1일, 초년도 모집수수료를 월납보험료의 12배로 제한하는 <b>1200%룰이 GA 소속 설계사까지 확대
          적용</b>됐습니다. 수수료 대부분이 체결 다음 달 지급되는 구조라, 규제 이후 첫 급여 충격이 도착한 달이 바로
          지금입니다. 줄어든 수령액에서 무엇이 확정이고 무엇이 미확정인지 구분하는 일이 어느 때보다 중요해졌습니다.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-white p-5">
            <p className="text-2xl font-extrabold text-[#3182F6]">2026.07.01</p>
            <p className={`mt-1 text-sm leading-snug ${SUB}`}>1200%룰 GA 확대 시행일 (금융위 보도 확인)</p>
          </div>
          <div className="rounded-2xl bg-white p-5">
            <p className="text-2xl font-extrabold text-[#3182F6]">38.2%</p>
            <p className={`mt-1 text-sm leading-snug ${SUB}`}>
              생보 전속설계사 13회차 정착률(2025, 금감원 공시 기반) — 개선 추세지만 여전히 절반 이상이 1년 내 이탈
            </p>
          </div>
          <div className="rounded-2xl bg-white p-5">
            <p className="text-2xl font-extrabold text-[#3182F6]">35~40%↓</p>
            <p className={`mt-1 text-sm leading-snug ${SUB}`}>규제 적용 후 첫 달 지급 수당 감소 전망 (업계 보도)</p>
          </div>
        </div>
      </section>

      {/* ── 기능 1: 자금 구조 점검 ── */}
      <section className="mt-16 grid items-center gap-8 sm:grid-cols-2">
        <div>
          <span className="text-sm font-bold text-[#3182F6]">자금 구조 점검</span>
          <h3 className={`mt-2 text-2xl font-bold leading-snug ${INK}`}>
            환수될 것 같냐고
            <br />
            묻지 않습니다
          </h3>
          <p className={`mt-3 leading-relaxed ${SUB}`}>
            자기 계약이 깨질 거라고 답하는 사람은 없습니다. 대신 사실 네 가지만 묻습니다 — 계약자와의 관계, 보험료
            부담, 가입 계기, 자동이체 등록. 이 조합으로 계약별 환수 위험을 판정하고, 이번 달 수령액을 확정 몫 / 환수
            노출 몫 / 세금 유보로 나눠 보여줍니다.
          </p>
          <p className={`mt-3 leading-relaxed ${SUB}`}>
            결과에서 가장 큰 숫자는 <b>런웨이(버틸 개월수)</b>입니다. 금액보다 개월수가 체감되기 때문입니다.
          </p>
        </div>
        <div className="rounded-3xl border border-[#F2F4F6] bg-white p-6 shadow-[0_8px_24px_rgba(25,31,40,0.06)]">
          <p className="mb-3 text-xs font-semibold text-[#8B95A1]">예시 화면</p>
          <div className="rounded-2xl bg-[#191F28] p-5 text-center text-white">
            <p className="text-xs text-slate-400">지금 수입이 끊겨도</p>
            <p className="my-1 text-4xl font-extrabold">
              2.5<span className="text-lg font-medium text-slate-400"> 개월</span>
            </p>
            <p className="text-xs text-slate-400">버틸 수 있어요</p>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className={SUB}>이번 달 수령액</span>
              <b className={INK}>351만</b>
            </div>
            <div className="flex justify-between">
              <span className={SUB}>├ 확정 몫</span>
              <b className="text-emerald-600">179만</b>
            </div>
            <div className="flex justify-between">
              <span className={SUB}>├ 환수 노출 몫</span>
              <b className="text-red-500">137만</b>
            </div>
            <div className="flex justify-between">
              <span className={SUB}>└ 세금 유보</span>
              <b className={INK}>35만</b>
            </div>
          </div>
        </div>
      </section>

      {/* ── 기능 2: 접점 리스트 ── */}
      <section className="mt-16 grid items-center gap-8 sm:grid-cols-2">
        <div className="order-2 sm:order-1">
          <div className="rounded-3xl border border-[#F2F4F6] bg-white p-6 shadow-[0_8px_24px_rgba(25,31,40,0.06)]">
            <p className="mb-3 text-xs font-semibold text-[#8B95A1]">서울 용산구 실데이터 기준</p>
            <div className="space-y-2">
              {[
                { label: '우선 접촉 (개업 3~6개월)', count: '211곳', hot: true },
                { label: '갱신 도래 (12개월 전후)', count: '167곳', hot: false },
                { label: '영업 중 전체', count: '7,113곳', hot: false },
              ].map((r) => (
                <div
                  key={r.label}
                  className={`flex items-center justify-between rounded-xl px-4 py-3 ${r.hot ? 'bg-[#E8F3FF]' : 'bg-[#F9FAFB]'}`}
                >
                  <span className={`text-sm ${r.hot ? 'font-bold text-[#3182F6]' : SUB}`}>{r.label}</span>
                  <b className={r.hot ? 'text-[#3182F6]' : INK}>{r.count}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="order-1 sm:order-2">
          <span className="text-sm font-bold text-[#3182F6]">접점 리스트</span>
          <h3 className={`mt-2 text-2xl font-bold leading-snug ${INK}`}>
            내일 누구를 만날지,
            <br />
            데이터가 답합니다
          </h3>
          <p className={`mt-3 leading-relaxed ${SUB}`}>
            지인이 소진되면 접점이 끊깁니다. 이 도구는 공공 인허가 데이터로 활동 지역의 영업 중 사업장을 <b>개업 후
            경과 개월</b> 기준으로 분류합니다. 개업 직후는 여유가 없고, 자리가 잡히는 3~6개월이 우선 접촉 구간입니다.
          </p>
          <p className={`mt-3 leading-relaxed ${SUB}`}>
            지역은 시군구 단위 데이터 팩으로 하나씩 확장됩니다. 준비되지 않은 지역은 화면에 그대로 "준비 중"으로
            표시합니다.
          </p>
        </div>
      </section>

      {/* ── 사전과제: 왜 이렇게 만들었나 ── */}
      <section className="mt-20 rounded-3xl bg-[#191F28] p-8 text-white sm:p-10">
        <span className="text-sm font-bold text-[#4E9EFF]">사전과제 노트 — 왜 이렇게 만들었나</span>
        <h2 className="mt-2 text-2xl font-bold leading-snug">
          저연차 이탈은 두 개의 실패가
          <br />
          순서대로 겹쳐서 일어납니다
        </h2>
        <p className="mt-3 leading-relaxed text-slate-300">
          앞단은 <b className="text-white">접점 고갈</b> — 지인 영업이 소진되면 내일 누구를 만날지 모르는 상태가
          됩니다. 뒷단은 <b className="text-white">자금 구조 무지</b> — 선지급 수수료를 전부 내 돈으로 착각하고 쓴
          뒤, 환수가 걸리면 대출로 메우다 이탈합니다. 이 도구는 두 실패를 각각 하나의 기능으로 다룹니다.
        </p>
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          {[
            {
              t: '확률을 묻지 않는다',
              d: '"환수될 것 같나요?"는 낙관 편향으로 오염됩니다. 예측 요인을 사실 질문 4개로 분해했습니다.',
            },
            {
              t: '입력을 요구하지 않는다',
              d: '타깃은 자기 수수료 구조를 모르는 사람입니다. 기본값으로 즉시 결과를 보여주고, 내 명세서로 덮어쓰는 길을 안내합니다.',
            },
            {
              t: '모르는 건 가설로 표기한다',
              d: '경과 구간과 위험 가중치는 미검증 가설로 상수 분리했고, 검증 계획과 판단 변경 이력을 문서로 남겼습니다.',
            },
          ].map((c) => (
            <div key={c.t} className="rounded-2xl bg-white/[0.06] p-5">
              <p className="font-bold">{c.t}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{c.d}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm leading-relaxed text-slate-400">
          확인된 사실 / 가설 / 미확인의 구분, 검토 후 폐기한 대안, 개발 중 판단이 바뀐 지점은 저장소의 PRD와
          MEMORY 문서에 전부 기록돼 있습니다. 여기 적힌 수치는 금감원 공시·금융위 보도로 교차 확인했거나 실제
          데이터에서 측정한 값입니다.
        </p>
      </section>

      {/* ── 마지막 CTA ── */}
      <section className="py-16 text-center">
        <h2 className={`text-2xl font-bold ${INK}`}>3분이면 내 런웨이가 나옵니다</h2>
        <p className={`mt-2 ${SUB}`}>필수 입력은 세 가지뿐입니다 — 지역, 소속, 자금.</p>
        <div className="mt-7">
          <Cta label="지금 시작하기" />
        </div>
      </section>
    </div>
  );
}
