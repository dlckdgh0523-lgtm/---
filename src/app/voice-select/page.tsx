/**
 * /voice-select — 음성 상담 방식 선택 화면.
 *
 * 접점 상세 패널의 "이 사장님과 방문 상담 연습"과 실제 롤플레잉 사이에 끼워, 두 방식 중 하나를
 * 고르게 한다. 짧고 결정하기 쉽게만 만들고, 상세 비교는 /voice-lab으로 링크한다.
 *
 * 방식 A(순차)는 사용 가능(기존 /roleplay). 방식 B(직결)는 ElevenLabs Conversational AI 키
 * (convai 권한)가 없어 현재 사용 불가 — 버튼을 비활성화하고 이유를 표시한다.
 * 기존 /roleplay 코드는 건드리지 않는다.
 */
import Link from 'next/link';

const INK = 'text-[#191F28]';
const SUB = 'text-[#4E5968]';

export default async function VoiceSelectPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string; place?: string }>;
}) {
  const sp = await searchParams;
  const region = sp.region ?? '';
  const place = sp.place ?? '';
  const roleplayHref = `/roleplay?region=${encodeURIComponent(region)}&place=${encodeURIComponent(place)}`;

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-4">
      <header>
        <h1 className={`text-xl font-extrabold ${INK}`}>음성 상담 방식 선택</h1>
        <p className={`mt-1 text-sm ${SUB}`}>
          같은 사장님과의 음성 연습을 두 가지 구조로 준비했습니다. 하나를 고르세요. 자세한 비교는{' '}
          <Link href="/voice-lab" className="font-semibold text-[#3182F6] underline">
            /voice-lab
          </Link>
          에 있습니다.
        </p>
      </header>

      {/* 방식 A — 사용 가능 */}
      <section className="rounded-2xl border border-[#3182F6] bg-[#F5F9FF] p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-[#3182F6]">방식 A · 순차 (STT → LLM → TTS)</p>
          <span className="rounded-full bg-[#3182F6] px-2.5 py-0.5 text-xs font-semibold text-white">사용 가능</span>
        </div>
        <p className={`mt-2 text-sm leading-relaxed ${SUB}`}>
          음성을 텍스트로 바꿔 모델에 전달하고, 답을 다시 음성으로 읽어 주는 방식입니다.
        </p>
        <ul className={`mt-2 space-y-1 text-sm ${SUB}`}>
          <li>· 됨: 채점 · 가드 필터 · 페르소나 상태 관리</li>
          <li>· 끼어들기: 옵트인(헤드폰 전제)</li>
          <li>· 첫 응답 지연: 약 2.4초 (실측)</li>
        </ul>
        <Link
          href={roleplayHref}
          className="mt-4 inline-block rounded-xl bg-[#3182F6] px-5 py-2.5 text-sm font-bold text-white"
        >
          이 방식으로 연습 →
        </Link>
      </section>

      {/* 방식 B — 사용 가능 (ElevenLabs Conversational AI) */}
      <section className="rounded-2xl border border-emerald-300 bg-emerald-50/40 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-emerald-700">방식 B · 음성-음성 직결 (ElevenLabs)</p>
          <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-semibold text-white">실험 · 사용 가능</span>
        </div>
        <p className={`mt-2 text-sm leading-relaxed ${SUB}`}>
          음성을 텍스트로 바꾸지 않고 모델에 직접 보내고, 음성으로 답을 받는 방식입니다. 대화가 자연스럽고 지연이
          낮은 대신, 중간에 코드가 낄 자리가 없습니다.
        </p>
        <ul className={`mt-2 space-y-1 text-sm ${SUB}`}>
          <li>· 안 됨: 채점 · 가드 필터 · 페르소나 상태 관리</li>
          <li>· 끼어들기: 네이티브</li>
          <li>· 무료 대화 시간: 월 15분 (ElevenLabs 무료 플랜)</li>
        </ul>
        <Link
          href={`/voice-direct?region=${encodeURIComponent(region)}&place=${encodeURIComponent(place)}`}
          className="mt-4 inline-block rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white"
        >
          이 방식으로 연습 →
        </Link>
        <p className="mt-2 text-xs text-slate-400">
          키/에이전트가 설정돼 있지 않으면 시작 시 그 사유를 표시하고 이 화면으로 되돌립니다.
        </p>
      </section>

      <div className="pt-1">
        <Link href="/places" className="text-sm font-semibold text-[#3182F6]">
          ← 접점 지도로 돌아가기
        </Link>
      </div>
    </div>
  );
}
