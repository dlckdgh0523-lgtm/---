'use client';

/**
 * /voice-direct — 방식 B: 음성-음성 직결 (ElevenLabs Conversational AI).
 *
 * 목적은 대화가 얼마나 자연스러운지 보는 것. 화면은 최소지만, 방식 A처럼
 * 듣는 중 / 생각 중 / 말하는 중을 색·형태로 명확히 구분하고 말풍선 스레드를 보여준다
 * (직결이라 상태 판단 근거는 SDK의 mode + transcript 이벤트뿐 — 상태관리·채점·가드는 없음).
 * 기존 /roleplay 코드는 참조도 복제도 하지 않는다.
 * 키/에이전트가 없거나 실패하면 선택 화면(/voice-select)으로 되돌리고 이유를 표시한다.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAccount } from '@/lib/account';

type Phase = 'idle' | 'connecting' | 'active' | 'ended' | 'error';
type Talk = 'listening' | 'thinking' | 'speaking';

const INK = 'text-[#191F28]';
const SUB = 'text-[#4E5968]';

export default function VoiceDirectPage() {
  const { status: authStatus } = useAccount();
  const [phase, setPhase] = useState<Phase>('idle');
  const [talk, setTalk] = useState<Talk>('listening');
  const [errorMsg, setErrorMsg] = useState('');
  const [firstLatencyMs, setFirstLatencyMs] = useState<number | null>(null);
  const [log, setLog] = useState<{ who: 'user' | 'agent'; text: string }[]>([]);

  const convRef = useRef<any>(null);
  const startedAtRef = useRef(0);
  const pendingReplyRef = useRef(false); // 사용자 발화 후 사장님 응답 대기 중인가 → '생각 중'
  const firstDoneRef = useRef(false);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const params = useRef<{ region: string; place: string }>({ region: '', place: '' });

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    params.current = { region: sp.get('region') ?? '', place: sp.get('place') ?? '' };
  }, []);

  // 스레드 자동 스크롤
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log, talk]);

  const start = useCallback(async () => {
    setErrorMsg('');
    setLog([]);
    setFirstLatencyMs(null);
    firstDoneRef.current = false;
    pendingReplyRef.current = false;
    setTalk('listening');
    setPhase('connecting');

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErrorMsg('마이크 권한이 필요합니다. 브라우저에서 마이크를 허용해 주세요.');
      setPhase('error');
      return;
    }

    let session: any;
    try {
      const res = await fetch('/api/convai/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ region: params.current.region, placeId: params.current.place }),
      });
      session = await res.json();
    } catch {
      setErrorMsg('세션 발급에 실패했습니다. 잠시 후 다시 시도하세요.');
      setPhase('error');
      return;
    }
    if (session?.status === 'disabled') {
      setErrorMsg('음성 직결이 아직 설정되지 않았습니다(ELEVENLABS 키/에이전트 미설정).');
      setPhase('error');
      return;
    }
    if (session?.status !== 'ok' || !session.signedUrl) {
      const code = session?.code;
      setErrorMsg(
        code === 401
          ? 'ElevenLabs 인증 오류(키 권한). 관리자 설정을 확인해 주세요.'
          : code === 429
            ? '무료 대화 시간(월 15분)을 모두 썼습니다. 다음 달 초기화되거나 유료 플랜이 필요합니다.'
            : `세션 발급 오류${code ? ` (코드 ${code})` : ''}.`,
      );
      setPhase('error');
      return;
    }

    try {
      const { Conversation } = await import('@elevenlabs/client');
      startedAtRef.current = performance.now();
      const conv = await Conversation.startSession({
        signedUrl: session.signedUrl,
        connectionType: 'websocket',
        overrides: {
          agent: {
            prompt: { prompt: session.prompt },
            firstMessage: session.firstMessage,
            language: session.language ?? 'ko',
          },
        },
        onConnect: () => setPhase('active'),
        onDisconnect: () => setPhase((p) => (p === 'error' ? p : 'ended')),
        onError: (msg: any) => {
          setErrorMsg(typeof msg === 'string' ? msg : '대화 중 오류가 발생했습니다.');
          setPhase('error');
        },
        onModeChange: (m: any) => {
          if (m?.mode === 'speaking') {
            pendingReplyRef.current = false;
            setTalk('speaking');
            if (startedAtRef.current && !firstDoneRef.current) {
              firstDoneRef.current = true;
              setFirstLatencyMs(Math.round(performance.now() - startedAtRef.current));
            }
          } else {
            // 사용자 발화 직후엔 '생각 중'을 유지, 아니면 '듣는 중'
            setTalk(pendingReplyRef.current ? 'thinking' : 'listening');
          }
        },
        onMessage: (m: any) => {
          const text = (m?.message ?? '').trim();
          const who: 'user' | 'agent' = m?.source === 'user' ? 'user' : 'agent';
          if (!text) return;
          if (who === 'user') {
            pendingReplyRef.current = true; // 내 말이 인식됨 → 사장님 응답 대기
            setTalk('thinking');
          } else {
            pendingReplyRef.current = false;
          }
          setLog((prev) => [...prev.slice(-14), { who, text }]);
        },
      });
      convRef.current = conv;
    } catch (e) {
      setErrorMsg(`대화 시작 실패: ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
      setPhase('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const end = useCallback(async () => {
    try {
      await convRef.current?.endSession();
    } catch {
      /* noop */
    }
    convRef.current = null;
    setPhase('ended');
  }, []);

  useEffect(
    () => () => {
      void convRef.current?.endSession?.();
    },
    [],
  );

  if (authStatus !== 'ready') return null;

  const backHref = `/voice-select?region=${encodeURIComponent(params.current.region)}&place=${encodeURIComponent(params.current.place)}`;

  const statusView = {
    listening: { icon: '🎤', label: '듣는 중 — 말하세요', color: 'text-[#3182F6]' },
    thinking: { icon: '💭', label: '사장님이 답을 준비 중…', color: 'text-amber-600' },
    speaking: { icon: '🔊', label: '사장님이 말하는 중', color: 'text-emerald-600' },
  }[talk];

  return (
    <div className="mx-auto max-w-lg py-6">
      <div className="mb-3 flex items-center justify-between">
        <h1 className={`text-lg font-extrabold ${INK}`}>음성 직결 상담 (방식 B)</h1>
        <Link href={backHref} className="text-sm text-[#3182F6]">
          방식 선택 →
        </Link>
      </div>

      {(phase === 'idle' || phase === 'ended' || phase === 'error') && (
        <div className="flex min-h-[42vh] flex-col items-center justify-center rounded-2xl bg-[#F9FAFB] p-6 text-center">
          {phase === 'idle' && (
            <>
              <p className="text-5xl">🎙️</p>
              <p className={`mt-3 text-sm ${SUB}`}>
                시작을 누르고 사장님에게 바로 말하세요. 음성을 그대로 모델에 보내고 음성으로 답이 옵니다(끼어들기 가능).
              </p>
              <button onClick={() => void start()} className="mt-5 rounded-2xl bg-[#3182F6] px-6 py-3 font-bold text-white">
                대화 시작
              </button>
            </>
          )}
          {phase === 'ended' && (
            <>
              <p className="text-5xl">✅</p>
              <p className={`mt-3 font-bold ${INK}`}>대화가 종료됐습니다</p>
              <button onClick={() => void start()} className="mt-4 rounded-2xl bg-[#3182F6] px-5 py-2.5 text-sm font-bold text-white">
                다시 대화
              </button>
            </>
          )}
          {phase === 'error' && (
            <>
              <p className="text-5xl">⚠️</p>
              <p className="mt-3 text-sm text-red-600">{errorMsg}</p>
              <Link href={backHref} className="mt-4 rounded-2xl border border-slate-300 px-5 py-2.5 text-sm">
                방식 선택으로 돌아가기
              </Link>
            </>
          )}
        </div>
      )}

      {phase === 'connecting' && (
        <div className="flex min-h-[42vh] flex-col items-center justify-center rounded-2xl bg-[#F9FAFB] p-6 text-center">
          <p className="animate-pulse text-5xl">🔌</p>
          <p className="mt-3 font-bold text-amber-600">연결 중…</p>
        </div>
      )}

      {phase === 'active' && (
        <div className="flex flex-col">
          {/* 상태 — 방식 A와 동일하게 색·형태·움직임으로 구분 */}
          <div className="flex flex-col items-center gap-1.5 py-1">
            <div className="flex items-center gap-2">
              <span className={talk === 'thinking' ? 'animate-pulse text-2xl' : 'text-2xl'}>{statusView.icon}</span>
              <span className={`text-sm font-bold ${statusView.color}`}>{statusView.label}</span>
              {talk === 'thinking' && (
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500" />
                </span>
              )}
            </div>
            {talk === 'listening' && (
              <span className="flex items-center gap-1.5 text-xs text-[#3182F6]">
                <span className="h-2 w-2 animate-ping rounded-full bg-[#3182F6]" />
                지금 말하면 됩니다
              </span>
            )}
            {talk === 'speaking' && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-600">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                끼어들어 말해도 됩니다
              </span>
            )}
            {firstLatencyMs !== null && (
              <span className="text-[11px] text-slate-400">첫 응답까지 {(firstLatencyMs / 1000).toFixed(1)}초 (실측)</span>
            )}
          </div>

          {/* 대화 스레드 — 나/사장님 말풍선 */}
          <div ref={threadRef} className="mt-2 max-h-[46vh] min-h-[34vh] space-y-2 overflow-y-auto rounded-2xl bg-[#F9FAFB] p-4">
            {log.length === 0 && (
              <p className="py-10 text-center text-sm text-slate-400">말을 걸면 여기에 대화가 표시됩니다.</p>
            )}
            {log.map((l, i) => (
              <div key={i} className={l.who === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    l.who === 'user' ? 'bg-[#3182F6] text-white' : 'border border-[#EDF0F3] bg-white text-[#191F28]'
                  }`}
                >
                  <span className="mb-0.5 block text-[11px] opacity-60">{l.who === 'user' ? '나' : '사장님'}</span>
                  {l.text}
                </div>
              </div>
            ))}
            {talk === 'thinking' && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-[#EDF0F3] bg-white px-3.5 py-2 text-sm text-slate-400">사장님이 생각 중…</div>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-center">
            <button onClick={() => void end()} className="rounded-full border border-red-300 px-5 py-2 text-sm text-red-600">
              대화 종료
            </button>
          </div>
        </div>
      )}

      <p className="mt-3 text-center text-xs text-slate-400">
        방식 B는 자연스러움을 보는 실험입니다. 채점·가드·상태 관리는 없습니다(그건 방식 A). 무료 대화 시간은 월 15분입니다.
      </p>
    </div>
  );
}
