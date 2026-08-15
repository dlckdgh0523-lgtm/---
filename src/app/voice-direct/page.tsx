'use client';

/**
 * /voice-direct — 방식 B: 음성-음성 직결 (ElevenLabs Conversational AI).
 *
 * 목적은 대화가 얼마나 자연스러운지 보는 것. 화면은 최소 — 말하고 듣는 것만.
 * 상태 관리·종료 로직·채점·가드는 이번 범위에서 제외한다(그게 방식 A와의 차이).
 * 기존 /roleplay 코드는 참조도 복제도 하지 않는다.
 *
 * 키/에이전트가 없거나 실패하면 선택 화면(/voice-select)으로 되돌리고 이유를 표시한다.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAccount } from '@/lib/account';

type Phase = 'idle' | 'connecting' | 'active' | 'ended' | 'error';
type Mode = 'listening' | 'speaking';

const INK = 'text-[#191F28]';
const SUB = 'text-[#4E5968]';

export default function VoiceDirectPage() {
  const { status: authStatus } = useAccount();
  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<Mode>('listening');
  const [errorMsg, setErrorMsg] = useState('');
  const [firstLatencyMs, setFirstLatencyMs] = useState<number | null>(null);
  const [log, setLog] = useState<{ who: 'user' | 'agent'; text: string }[]>([]);

  const convRef = useRef<any>(null);
  const startedAtRef = useRef(0);
  const params = useRef<{ region: string; place: string }>({ region: '', place: '' });

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    params.current = { region: sp.get('region') ?? '', place: sp.get('place') ?? '' };
  }, []);

  const start = useCallback(async () => {
    setErrorMsg('');
    setLog([]);
    setFirstLatencyMs(null);
    setPhase('connecting');

    // 1) 마이크 권한 (직결은 오디오를 직접 보냄)
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErrorMsg('마이크 권한이 필요합니다. 브라우저에서 마이크를 허용해 주세요.');
      setPhase('error');
      return;
    }

    // 2) 서버에서 서명 URL + 페르소나 프롬프트 발급 (키는 서버에만)
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

    // 3) ElevenLabs SDK로 세션 시작 (SSR 회피 위해 동적 import)
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
          const mo: Mode = m?.mode === 'speaking' ? 'speaking' : 'listening';
          setMode(mo);
          // 첫 사장님 발화까지의 지연 실측 (비교표용)
          if (mo === 'speaking' && startedAtRef.current && firstLatencyMs === null) {
            setFirstLatencyMs(Math.round(performance.now() - startedAtRef.current));
          }
        },
        onMessage: (m: any) => {
          const text = m?.message ?? '';
          const who: 'user' | 'agent' = m?.source === 'user' ? 'user' : 'agent';
          if (text) setLog((prev) => [...prev.slice(-8), { who, text }]);
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

  return (
    <div className="mx-auto max-w-lg py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className={`text-lg font-extrabold ${INK}`}>음성 직결 상담 (방식 B)</h1>
        <Link href={backHref} className="text-sm text-[#3182F6]">
          방식 선택 →
        </Link>
      </div>

      <div className="flex min-h-[46vh] flex-col items-center justify-center rounded-2xl bg-[#F9FAFB] p-6 text-center">
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

        {phase === 'connecting' && (
          <>
            <p className="animate-pulse text-5xl">🔌</p>
            <p className={`mt-3 font-bold text-amber-600`}>연결 중…</p>
          </>
        )}

        {phase === 'active' && (
          <>
            <p className={`text-6xl ${mode === 'speaking' ? '' : 'animate-pulse'}`}>{mode === 'speaking' ? '🔊' : '🎤'}</p>
            <p className={`mt-3 text-xl font-extrabold ${mode === 'speaking' ? 'text-emerald-600' : 'text-[#3182F6]'}`}>
              {mode === 'speaking' ? '사장님이 말하는 중' : '듣는 중 — 말하세요'}
            </p>
            {firstLatencyMs !== null && (
              <p className="mt-1 text-xs text-slate-400">첫 응답까지 {(firstLatencyMs / 1000).toFixed(1)}초 (실측)</p>
            )}
            {log.length > 0 && (
              <div className="mt-4 max-h-40 w-full space-y-1 overflow-y-auto text-left text-sm">
                {log.map((l, i) => (
                  <p key={i} className={l.who === 'user' ? INK : SUB}>
                    <b>{l.who === 'user' ? '나' : '사장님'}:</b> {l.text}
                  </p>
                ))}
              </div>
            )}
            <button onClick={() => void end()} className="mt-5 rounded-full border border-red-300 px-5 py-2 text-sm text-red-600">
              대화 종료
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

      <p className="mt-3 text-center text-xs text-slate-400">
        방식 B는 자연스러움을 보는 실험입니다. 채점·가드·상태 관리는 없습니다(그건 방식 A). 무료 대화 시간은 월 15분입니다.
      </p>
    </div>
  );
}
