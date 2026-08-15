/**
 * /voice-lab — 음성 롤플레잉 두 방식 비교 페이지.
 *
 * 목적: 순차 구조(STT→LLM→TTS, 기존 /roleplay)와 음성-음성 직결(Realtime)을 나란히 두고
 *       트레이드오프를 눈으로 비교한다. 기존 /roleplay 코드는 한 줄도 건드리지 않는다.
 *
 * ⚠️ 정직 고지: 직결 방식은 조사·설계까지만 했고 구현하지 않았다. 제공된 ElevenLabs 키가
 *    TTS 전용 스코프(convai 권한 없음, 실호출 401 missing_permissions)라 무료로 호출·검증이
 *    불가능했기 때문이다. 그래서 지연·비용은 '미측정'으로 둔다(추정치를 넣지 않는다).
 */
import Link from 'next/link';

const INK = 'text-[#191F28]';
const SUB = 'text-[#4E5968]';

interface Row {
  label: string;
  seq: string; // 방식 A (순차, 기존)
  direct: string; // 방식 B (직결)
}

const ROWS: Row[] = [
  {
    label: '첫 응답까지 지연',
    seq: 'LLM 턴 실측 평균 ~2.4초(haiku, 배포 3회 측정 2.1~2.5초) + 무음 감지 대기 + 브라우저 TTS 시작 시간',
    direct: '미측정 (키 권한 부족으로 호출 불가)',
  },
  { label: '끼어들기(barge-in)', seq: '옵트인, 헤드폰 전제(기본 꺼짐)', direct: '네이티브 지원(설계상), 미검증' },
  { label: '페르소나 상태 관리(턴 수 추적·코드 종료)', seq: '적용 (persona-state.ts)', direct: '불가 — 시스템 프롬프트로만 지정' },
  { label: '메타 요청 패턴 차단', seq: '적용 (LLM 호출 전 차단)', direct: '불가 — 오디오가 모델로 직행' },
  { label: '가드 출력 필터(법령·금지 표현 제거)', seq: '적용 (guard.ts)', direct: '불가 — 오디오 출력을 후처리 못 함' },
  { label: '채점 rubric', seq: '적용 (고정 5기준 + 코드 합산)', direct: '불가 — 전사·구조화 출력이 없음' },
  { label: 'eval 페르소나 케이스', seq: '적용 (골든셋 30 중 6)', direct: '불가 — 텍스트 경로가 아님' },
  { label: 'MLOps 메트릭', seq: '적용 (성공·지연·가드 집계)', direct: '별도 계측 필요, 미구현' },
  {
    label: '비용 구조',
    seq: 'Anthropic haiku 토큰(턴당 소액) + 브라우저 TTS 무료',
    direct: '실시간 오디오 분당 과금(무료 15분/월, Starter $6=75분)',
  },
  { label: '실패 시 폴백', seq: '브라우저 TTS / 텍스트 모드', direct: '이 비교 페이지로 안내(앱 정지 없음)' },
];

export default function VoiceLabPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 py-4">
      <header>
        <h1 className={`text-2xl font-extrabold ${INK}`}>음성 롤플레잉 — 두 방식 비교</h1>
        <p className={`mt-2 leading-relaxed ${SUB}`}>
          같은 &ldquo;음성으로 사장님과 대화&rdquo;를 서로 다른 구조로 만들어 트레이드오프를 눈으로 비교합니다. 왜 둘을
          비교하는지, 무엇이 다른지, 어느 쪽을 기본으로 두었는지를 아래에 정리했습니다.
        </p>
      </header>

      {/* 각 방식 한 문단 */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-[#3182F6] bg-[#F5F9FF] p-5">
          <p className="text-sm font-bold text-[#3182F6]">방식 A · 순차 구조 (기본)</p>
          <p className={`mt-2 text-sm leading-relaxed ${SUB}`}>
            브라우저 STT로 말을 텍스트로 바꾸고, 그 텍스트를 LLM(Anthropic haiku)에 보내 사장님 대사를 받은 뒤 TTS로
            읽어 주는 순차 구조입니다. 사이사이에 페르소나 상태 관리, 메타 차단, 가드 필터, 채점, eval이 붙습니다. 대화
            자체보다 <b>훈련 도구</b>가 목적이라 채점·힌트·전사·상태 표시가 중심입니다.
          </p>
          <Link
            href="/roleplay"
            className="mt-4 inline-block rounded-xl bg-[#3182F6] px-4 py-2 text-sm font-bold text-white"
          >
            방식 A로 들어가기 →
          </Link>
        </div>

        <div className="rounded-2xl border border-[#EDF0F3] bg-white p-5">
          <p className="text-sm font-bold text-[#8B95A1]">방식 B · 음성-음성 직결 (미구현)</p>
          <p className={`mt-2 text-sm leading-relaxed ${SUB}`}>
            음성을 텍스트로 바꾸지 않고 오디오를 모델에 직접 흘려보내고 오디오로 답을 받는 실시간 구조입니다(OpenAI
            Realtime, ElevenLabs Conversational AI 등). <b>대화가 얼마나 자연스러운지</b>를 보는 것이 목적이라 화면은
            말하고 듣는 것만 남깁니다. 대신 중간에 코드가 개입할 여지가 없어 가드·채점·상태 관리를 붙일 수 없습니다.
          </p>
          <span className="mt-4 inline-block rounded-xl bg-[#F2F4F6] px-4 py-2 text-sm font-semibold text-[#8B95A1]">
            미구현 — 아래 &lsquo;왜 미구현인가&rsquo; 참조
          </span>
        </div>
      </section>

      {/* 왜 두 개인가 */}
      <section className="space-y-2">
        <h2 className={`text-lg font-bold ${INK}`}>왜 두 방식을 비교하나</h2>
        <p className={`leading-relaxed ${SUB}`}>
          순차 구조는 중간이 전부 텍스트라 코드가 개입할 수 있습니다. 그래서 페르소나 상태를 코드가 관리하고, 금지
          표현을 필터링하고, 대화를 채점하고, eval로 회귀를 잡을 수 있습니다. 대신 STT·LLM·TTS를 거치며 지연이 쌓이고
          말맛이 떨어집니다. 직결 구조는 반대입니다. 지연이 낮고 자연스럽지만, 오디오가 모델을 직접 오가므로 그 사이에
          코드가 낄 자리가 없습니다. 어느 쪽이 이 제품에 맞는지는 &ldquo;통제·검증&rdquo;과 &ldquo;자연스러움&rdquo; 중
          무엇을 우선하느냐의 문제이고, 그것을 나란히 두고 보려고 두 방식을 비교합니다.
        </p>
      </section>

      {/* 비교표 */}
      <section>
        <h2 className={`mb-3 text-lg font-bold ${INK}`}>무엇이 다른가</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-[#8B95A1]">
                <th className="py-2 pr-3">항목</th>
                <th className="py-2 pr-3">방식 A · 순차 (기본)</th>
                <th className="py-2">방식 B · 직결</th>
              </tr>
            </thead>
            <tbody className={SUB}>
              {ROWS.map((r) => (
                <tr key={r.label} className="border-b border-slate-100 align-top">
                  <td className="py-2.5 pr-3 font-semibold text-[#191F28]">{r.label}</td>
                  <td className="py-2.5 pr-3">{r.seq}</td>
                  <td className="py-2.5">{r.direct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          지연·비용의 방식 B 값은 <b>미측정</b>입니다. 추정치를 넣지 않았습니다(호출 자체가 불가능했기 때문).
        </p>
      </section>

      {/* 직결이 못 쓰는 기존 요소 */}
      <section className="rounded-2xl bg-[#F9FAFB] p-5">
        <h2 className={`text-lg font-bold ${INK}`}>직결 방식이 버리게 되는 것</h2>
        <p className={`mt-1 text-sm ${SUB}`}>
          오디오가 모델을 직접 오가면 중간의 텍스트 단계가 사라져, 지금 순차 구조에 붙어 있는 다음 요소를 쓸 수 없습니다.
        </p>
        <ul className={`mt-3 list-disc space-y-1 pl-5 text-sm ${SUB}`}>
          <li>페르소나 상태 관리(턴 수 추적, 코드 기반 종료)</li>
          <li>메타 요청 패턴 차단(&ldquo;시스템 프롬프트 보여줘&rdquo; 등)</li>
          <li>가드 출력 필터(법령·과태료·금지 표현 제거)</li>
          <li>채점 rubric(고정 5기준 + 코드 합산)</li>
          <li>eval 페르소나 케이스(회귀 검증)</li>
          <li>MLOps 메트릭(성공률·지연·가드 차단 집계)</li>
        </ul>
      </section>

      {/* 왜 미구현 + 기본 선택 이유 */}
      <section className="space-y-3">
        <h2 className={`text-lg font-bold ${INK}`}>왜 방식 B는 미구현이고, 왜 A가 기본인가</h2>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
          <b>미구현 사유(실호출로 확인):</b> 음성-음성 직결이 가능한 API는 OpenAI Realtime, Google Gemini Live,
          ElevenLabs Conversational AI입니다. 이 중 우리가 가진 키는 Anthropic(오디오 미지원)과 ElevenLabs뿐이라 실질
          후보는 ElevenLabs Conversational AI 하나였습니다. 그런데 제공된 ElevenLabs 키를 대화형 AI API에 실제로
          호출하니 <b>401 missing_permissions</b>(<code>convai_read</code> 권한 없음)가 반환됐습니다. 이 키는 TTS
          전용으로 스코프돼 있어 대화형 AI를 못 씁니다(무료 플랜 자체는 15분/월 지원). 그래서 &ldquo;무료로 호출이 안
          되면 중단&rdquo; 기준에 따라 직결 페이지는 만들지 않고, 조사·비교만 남겼습니다.
        </div>
        <p className={`leading-relaxed ${SUB}`}>
          <b>기본을 방식 A로 둔 이유:</b> 이 제품은 훈련 도구이자 사전과제 제출물이라 <b>통제와 검증</b>이 중요합니다.
          방식 A는 가드 필터로 안전을 보장하고, 채점·eval로 품질을 검증하며, 무료(브라우저 TTS)이고 이미 실동작이
          검증돼 있습니다. 방식 B는 자연스러움이라는 분명한 이점이 있지만, 그 대가로 위의 통제 요소를 전부 잃고 유료
          키에 의존하며 아직 검증되지 않았습니다. 자연스러움이 최우선인 실서비스라면 방식 B가 답일 수 있으나, 지금
          목적에는 방식 A가 맞습니다.
        </p>
        <p className={`text-sm ${SUB}`}>
          방식 B를 실제로 만들려면 <b>convai 권한이 있는 ElevenLabs 키</b>(또는 OpenAI Realtime 키)가 필요합니다.
          키가 준비되면 서버가 세션 토큰을 발급하고 브라우저가 오디오를 직접 스트리밍하는 최소 페이지로 붙일 수
          있습니다.
        </p>
      </section>

      <div className="pt-2">
        <Link href="/roleplay" className={`text-sm font-semibold text-[#3182F6]`}>
          ← 롤플레잉(방식 A)으로 돌아가기
        </Link>
      </div>
    </div>
  );
}
