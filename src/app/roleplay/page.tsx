'use client';

/**
 * /roleplay — 음성 기반 방문 상담 롤플레잉 (모의면접 형태).
 *
 * - 음성이 기본, 텍스트는 폴백 (SR 미지원 / 마이크 거부 시 동일 기능).
 * - 채팅 말풍선 나열이 아니라 중앙 상태 표시(듣는 중/생각 중/말하는 중) + 실시간 interim 전사.
 * - 에코 방지: TTS 재생 중 STT 중지(기본). barge-in은 헤드폰 전제 옵트인(기본 OFF).
 * - 크롬 SR 무음 자동 종료 → onend에서 세션 살아있으면 재시작. 발화 종료는 무음 타이머로 감지.
 * - confidence 보관 → 임계 미달 발화는 채점 근거 제외, 리뷰에서 수정 → 재채점.
 * - 개인정보: 브라우저 음성 인식은 구현체에 따라 음성이 외부 서버로 전송될 수 있음 —
 *   "금액은 로컬" 설계의 예외이므로 시작 전 고지·동의 필수.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAccount } from '@/lib/account';
import {
  CONFIDENCE_MIN,
  DIFFICULTY_LABEL,
  MAX_USER_TURNS,
  SILENCE_END_MS,
  VIRTUAL_AGE_BANDS,
  VIRTUAL_TEMPERS,
  type Difficulty,
} from '@/config/roleplay';
import type { CriterionVerdict, ScoreResult, TranscriptLine } from '@/app/api/llm/roleplay/score/route';
import type { Place } from '@/types';

const INK = 'text-[#191F28]';
const SUB = 'text-[#4E5968]';

// ---- 최소 SpeechRecognition 타입 (DOM lib 미포함) ----
interface SRAlt { transcript: string; confidence: number }
interface SREvent {
  resultIndex: number;
  results: { length: number; [i: number]: { isFinal: boolean; 0: SRAlt } };
}
interface SRLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

function getSRCtor(): (new () => SRLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SRLike; webkitSpeechRecognition?: new () => SRLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type Phase = 'setup' | 'live' | 'scoring' | 'review';
type LiveStatus = 'listening' | 'thinking' | 'speaking';

interface UtterLine extends TranscriptLine {
  confidence?: number;
}

export default function RoleplayPage() {
  const { status: authStatus, profile } = useAccount();
  const [place, setPlace] = useState<Place | null>(null);
  const [region, setRegion] = useState('');

  const [phase, setPhase] = useState<Phase>('setup');
  const [voiceMode, setVoiceMode] = useState(true); // false = 텍스트 폴백
  const [srSupported, setSrSupported] = useState(true);
  const [consent, setConsent] = useState(false);
  const [bargeIn, setBargeIn] = useState(false); // 헤드폰 전제 옵트인, 기본 OFF
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [ageIdx, setAgeIdx] = useState(0);
  const [temperIdx, setTemperIdx] = useState(0);

  const [liveStatus, setLiveStatus] = useState<LiveStatus>('listening');
  const [interim, setInterim] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const [transcript, setTranscript] = useState<UtterLine[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);
  const [hintCount, setHintCount] = useState(0);
  const [hints, setHints] = useState<string[] | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [notice, setNotice] = useState('');
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [editedTranscript, setEditedTranscript] = useState<UtterLine[]>([]);

  const recognitionRef = useRef<SRLike | null>(null);
  const sessionActiveRef = useRef(false);
  const speakingRef = useRef(false);
  const bargeInRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const utterFinalsRef = useRef<{ text: string; confidence: number }[]>([]);
  const transcriptRef = useRef<UtterLine[]>([]);
  const ttsQueueRef = useRef<string[]>([]);
  const streamDoneRef = useRef(true);
  const endedRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  transcriptRef.current = transcript;
  bargeInRef.current = bargeIn;

  // 쿼리 파라미터로 사업장 로드
  useEffect(() => {
    if (authStatus !== 'ready' || !profile) return;
    const params = new URLSearchParams(window.location.search);
    const r = params.get('region') ?? profile.region;
    const id = params.get('place');
    setRegion(r);
    if (!id) return;
    fetch(`/data/regions/${r}/places.json`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((places: Place[]) => setPlace(places.find((p) => p.id === id) ?? null))
      .catch(() => setPlace(null));
    setSrSupported(getSRCtor() !== null);
    setAgeIdx(Math.floor(Math.random() * VIRTUAL_AGE_BANDS.length));
    setTemperIdx(Math.floor(Math.random() * VIRTUAL_TEMPERS.length));
  }, [authStatus, profile]);

  // ---------- TTS: 문장 단위 큐 재생 (긴 텍스트 중단 이슈 회피) ----------
  const pickKoVoice = useCallback((): SpeechSynthesisVoice | null => {
    const voices = window.speechSynthesis.getVoices();
    return voices.find((v) => v.lang.startsWith('ko')) ?? null; // 없으면 기본 voice 폴백
  }, []);

  const stopRecognition = useCallback(() => {
    try {
      recognitionRef.current?.abort();
    } catch {
      /* noop */
    }
  }, []);

  const startRecognition = useCallback(() => {
    if (!sessionActiveRef.current || !voiceMode) return;
    const Ctor = getSRCtor();
    if (!Ctor) return;
    try {
      recognitionRef.current?.abort();
    } catch {
      /* noop */
    }
    const rec = new Ctor();
    rec.lang = 'ko-KR';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      // TTS 재생 중 입력: barge-in OFF면 무시(에코 방지), ON이면 끼어들기
      if (speakingRef.current) {
        if (!bargeInRef.current) return;
        window.speechSynthesis.cancel();
        ttsQueueRef.current = [];
        speakingRef.current = false;
        setLiveStatus('listening');
      }
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          utterFinalsRef.current.push({ text: res[0].transcript.trim(), confidence: res[0].confidence ?? 0 });
        } else {
          interimText += res[0].transcript;
        }
      }
      setInterim(interimText || utterFinalsRef.current.map((f) => f.text).join(' '));
      // 무음 타이머 재설정 — onspeechend에 의존하지 않는다 [미검증 가설: SILENCE_END_MS]
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => commitUtterance(), SILENCE_END_MS);
    };
    rec.onend = () => {
      // 크롬은 무음이 이어지면 인식을 자동 종료한다 → 세션이 살아있으면 재시작
      if (sessionActiveRef.current && !speakingRef.current) {
        setTimeout(() => {
          try {
            if (sessionActiveRef.current && !speakingRef.current) rec.start();
          } catch {
            /* 이미 시작됨 등 */
          }
        }, 150);
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setVoiceMode(false);
        setNotice('마이크를 사용할 수 없어 텍스트 모드로 전환했습니다. 기능은 동일합니다.');
        sessionActiveRef.current = true;
      }
    };
    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      /* noop */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceMode]);

  const speakSentences = useCallback(
    (onAllDone: () => void) => {
      const next = () => {
        const sentence = ttsQueueRef.current.shift();
        if (sentence === undefined) {
          if (streamDoneRef.current) {
            speakingRef.current = false;
            onAllDone();
          } else {
            setTimeout(next, 120); // 스트림이 아직 문장을 만드는 중 — 대기
          }
          return;
        }
        const u = new SpeechSynthesisUtterance(sentence);
        u.lang = 'ko-KR';
        const voice = pickKoVoice();
        if (voice) u.voice = voice;
        u.onend = next;
        u.onerror = next;
        window.speechSynthesis.speak(u);
      };
      speakingRef.current = true;
      if (!bargeInRef.current) stopRecognition(); // 에코 방지: 재생 중 STT 중지
      setLiveStatus('speaking');
      next();
    },
    [pickKoVoice, stopRecognition],
  );

  // ---------- 턴 전송 (스트리밍 수신 → 문장 큐) ----------
  const sendTurn = useCallback(
    async (userText: string) => {
      setLiveStatus('thinking');
      setInterim('');
      const history = transcriptRef.current.map((l) => ({ speaker: l.speaker, text: l.text }));
      streamDoneRef.current = false;
      ttsQueueRef.current = [];
      let ownerText = '';
      let started = false;

      const finishTurn = () => {
        if (endedRef.current || transcriptRef.current.filter((l) => l.speaker === 'user').length >= MAX_USER_TURNS) {
          void finishSession();
          return;
        }
        setLiveStatus('listening');
        utterFinalsRef.current = [];
        if (voiceMode) startRecognition();
      };

      try {
        const res = await fetch('/api/llm/roleplay/turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ region, placeId: place?.id, difficulty, ageIdx, temperIdx, history, userText }),
        });
        const reader = res.body?.getReader();
        if (!reader) throw new Error('no stream');
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line) continue;
            if (line === '__DISABLED__') {
              setNotice('ANTHROPIC_API_KEY 대기 중 — 키가 들어오면 대화가 활성화됩니다.');
              sessionActiveRef.current = false;
              setPhase('setup');
              return;
            }
            if (line === '__RATELIMIT__') {
              setNotice('오늘 대화 한도에 도달했습니다.');
              void finishSession();
              return;
            }
            if (line === '__ERROR__') {
              setNotice('응답 생성에 실패했습니다. 한 번 더 말해보세요.');
              finishTurn();
              return;
            }
            if (line === '__END__') {
              endedRef.current = true;
              continue;
            }
            if (line === '__META__') {
              // 서버가 메타 요청을 코드로 차단한 턴 — reply(앞 줄)는 이미 대사로 처리됨. 마커만 무시, 대화는 계속.
              continue;
            }
            // 정상 문장 — 전사에 누적 + TTS 큐
            ownerText = ownerText ? `${ownerText} ${line}` : line;
            setTranscript((prev) => {
              const last = prev[prev.length - 1];
              if (last?.speaker === 'owner' && started) {
                return [...prev.slice(0, -1), { ...last, text: ownerText }];
              }
              return [...prev, { speaker: 'owner', text: ownerText }];
            });
            ttsQueueRef.current.push(line);
            if (!started) {
              started = true;
              if (voiceMode) speakSentences(finishTurn); // 첫 문장 완성 즉시 재생 시작
            }
          }
        }
        streamDoneRef.current = true;
        if (!started) {
          // 문장이 하나도 없었음 (전부 필터되었거나 빈 응답)
          setNotice('사장님이 말없이 바라봅니다. 다시 말해보세요.');
          finishTurn();
        } else if (!voiceMode) {
          finishTurn();
        }
      } catch {
        streamDoneRef.current = true;
        setNotice('네트워크 오류 — 다시 말해보세요.');
        finishTurn();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [region, place, difficulty, ageIdx, temperIdx, voiceMode, speakSentences, startRecognition],
  );

  const commitUtterance = useCallback(() => {
    const finals = utterFinalsRef.current;
    if (finals.length === 0) return;
    utterFinalsRef.current = [];
    const text = finals.map((f) => f.text).join(' ').trim();
    if (!text) return;
    const avgConf = finals.reduce((s, f) => s + f.confidence, 0) / finals.length;
    const line: UtterLine = {
      speaker: 'user',
      text,
      confidence: Math.round(avgConf * 100) / 100,
      lowConfidence: avgConf < CONFIDENCE_MIN, // 임계 미달 → 채점 근거 제외 [미검증 가설]
    };
    setTranscript((prev) => [...prev, line]);
    transcriptRef.current = [...transcriptRef.current, line];
    stopRecognition();
    void sendTurn(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendTurn, stopRecognition]);

  // ---------- 마이크 레벨 시각화 ----------
  const startMicMeter = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        if (!sessionActiveRef.current) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        setMicLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      return true;
    } catch {
      return false;
    }
  }, []);

  // ---------- 세션 시작/종료 ----------
  async function startSession() {
    setNotice('');
    endedRef.current = false;
    setTranscript([]);
    transcriptRef.current = [];
    setHintCount(0);
    setHints(null);
    sessionActiveRef.current = true;
    setPhase('live');
    setLiveStatus('listening');
    if (voiceMode && srSupported) {
      const micOk = await startMicMeter();
      if (!micOk) {
        setVoiceMode(false);
        setNotice('마이크 권한이 거부되어 텍스트 모드로 시작합니다. 기능은 동일합니다.');
        return;
      }
      window.speechSynthesis.getVoices(); // voice 목록 미리 로드
      startRecognition();
    }
  }

  async function finishSession() {
    sessionActiveRef.current = false;
    stopRecognition();
    window.speechSynthesis.cancel();
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    void audioCtxRef.current?.close();
    const lines = transcriptRef.current;
    if (lines.filter((l) => l.speaker === 'user').length === 0) {
      setPhase('setup');
      return;
    }
    setPhase('scoring');
    setEditedTranscript(lines);
    await requestScore(lines);
  }

  async function requestScore(lines: UtterLine[]) {
    try {
      const res = await fetch('/api/llm/roleplay/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          region,
          placeId: place?.id,
          hintCount,
          transcript: lines.map((l) => ({ speaker: l.speaker, text: l.text, lowConfidence: l.lowConfidence ?? false })),
        }),
      });
      setScore((await res.json()) as ScoreResult);
    } catch {
      setScore({ status: 'error', message: '채점 요청 실패' });
    }
    setPhase('review');
  }

  async function requestHint() {
    setHintBusy(true);
    setHintCount((c) => c + 1); // 사용 횟수 기록 — 채점 감점 + 숙련도 지표
    try {
      const res = await fetch('/api/llm/roleplay/hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ region, placeId: place?.id, history: transcriptRef.current.map((l) => ({ speaker: l.speaker, text: l.text })) }),
      });
      const json = await res.json();
      setHints(json.status === 'ok' ? json.candidates : null);
      if (json.status === 'disabled') setNotice('ANTHROPIC_API_KEY 대기 중 — 힌트를 만들 수 없습니다.');
    } catch {
      setHints(null);
    }
    setHintBusy(false);
  }

  useEffect(() => () => {
    // 언마운트 정리
    sessionActiveRef.current = false;
    try {
      recognitionRef.current?.abort();
    } catch {
      /* noop */
    }
    if (typeof window !== 'undefined') window.speechSynthesis.cancel();
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  if (authStatus !== 'ready') return null;
  if (!place) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="font-semibold">사업장을 선택하세요</p>
        <p className="mt-2 text-sm text-slate-500">롤플레잉 페르소나는 접점 지도의 실제 사업장 데이터로 만들어집니다.</p>
        <Link href="/places" className="mt-4 inline-block rounded-2xl bg-[#3182F6] px-5 py-2 text-sm font-bold text-white">접점 지도로 →</Link>
      </div>
    );
  }

  const elapsed = (() => {
    const [y, m] = place.licenseDate.split('-').map(Number);
    const now = new Date();
    return Math.max(0, (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m));
  })();

  const placeBar = (
    <div className="sticky top-14 z-30 -mx-4 border-b border-[#F2F4F6] bg-white/95 px-4 py-2 backdrop-blur">
      <p className="text-sm">
        <b>{place.name}</b>{' '}
        <span className="text-slate-400">
          {place.category.large} · 개업 {elapsed}개월 · 난이도 {DIFFICULTY_LABEL[difficulty]} ·{' '}
          <span className="text-[#3182F6]">가상 설정: {VIRTUAL_AGE_BANDS[ageIdx]}·{VIRTUAL_TEMPERS[temperIdx]}</span>
        </span>
      </p>
    </div>
  );

  // ============ SETUP ============
  if (phase === 'setup') {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className={`text-xl font-extrabold ${INK}`}>방문 상담 롤플레잉</h1>
        <div className="rounded-2xl border border-[#F2F4F6] bg-white p-5">
          <p className="font-bold">{place.name}</p>
          <p className={`text-sm ${SUB}`}>{place.category.large} · {place.address} · 개업 {elapsed}개월</p>
          <p className="mt-2 text-xs text-slate-400">
            사장님의 나이대·성격은 데이터에 없어 <b>가상으로 설정</b>됩니다: {VIRTUAL_AGE_BANDS[ageIdx]},{' '}
            {VIRTUAL_TEMPERS[temperIdx]}{' '}
            <button
              onClick={() => {
                setAgeIdx(Math.floor(Math.random() * VIRTUAL_AGE_BANDS.length));
                setTemperIdx(Math.floor(Math.random() * VIRTUAL_TEMPERS.length));
              }}
              className="text-[#3182F6] underline"
            >
              다시 뽑기
            </button>
          </p>
        </div>

        <div className="rounded-2xl border border-[#F2F4F6] bg-white p-5">
          <p className="mb-2 text-sm font-semibold">난이도 — 태도만 다르고 사업장 사실은 동일합니다</p>
          <div className="flex gap-2">
            {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((d) => (
              <button
                key={d}
                onClick={() => setDifficulty(d)}
                className={`rounded-full border px-4 py-1.5 text-sm ${difficulty === d ? 'border-[#3182F6] bg-[#3182F6] text-white' : 'border-slate-300'}`}
              >
                {DIFFICULTY_LABEL[d]}
              </button>
            ))}
          </div>
        </div>

        {srSupported && voiceMode ? (
          <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-semibold">🎧 시작 전 확인</p>
            <p>
              <b>헤드폰(이어폰) 사용을 권장합니다.</b> 스피커로 들으면 AI 음성이 마이크로 들어가 인식이 꼬일 수
              있습니다.
            </p>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={bargeIn} onChange={(e) => setBargeIn(e.target.checked)} className="mt-0.5" />
              <span>끼어들어 말하기(barge-in) 허용 — <b>헤드폰 사용 시에만 켜세요</b> (기본 꺼짐)</span>
            </label>
            <label className="flex items-start gap-2 border-t border-amber-200 pt-3">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
              <span>
                브라우저 음성 인식은 구현체에 따라 <b>음성 데이터가 외부 서버(브라우저 제공사)로 전송될 수
                있습니다.</b> 이 앱은 금액 데이터를 서버로 보내지 않지만 음성은 예외임을 이해했습니다.
              </span>
            </label>
          </div>
        ) : (
          <div className="rounded-2xl bg-[#F9FAFB] p-4 text-sm text-slate-600">
            {srSupported ? '텍스트 모드로 진행합니다.' : '이 브라우저는 음성 인식을 지원하지 않아 텍스트 모드로 진행합니다.'}{' '}
            기능(대화·힌트·채점)은 음성 모드와 동일합니다.
          </div>
        )}
        {notice && <p className="text-sm text-amber-700">{notice}</p>}

        <div className="flex gap-2">
          <button
            onClick={() => void startSession()}
            disabled={voiceMode && srSupported && !consent}
            className="flex-1 rounded-2xl bg-[#3182F6] py-3 font-bold text-white disabled:bg-slate-300"
          >
            {voiceMode && srSupported ? '🎤 음성으로 시작' : '⌨️ 텍스트로 시작'}
          </button>
          {srSupported && (
            <button
              onClick={() => setVoiceMode((v) => !v)}
              className="rounded-2xl border border-slate-300 px-4 text-sm text-slate-600"
            >
              {voiceMode ? '텍스트 모드로' : '음성 모드로'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ============ LIVE (모의면접 화면) ============
  if (phase === 'live') {
    const statusView = {
      listening: { icon: '🎤', label: voiceMode ? '듣는 중' : '입력 대기', color: 'text-[#3182F6]' },
      thinking: { icon: '💭', label: '생각 중', color: 'text-amber-600' },
      speaking: { icon: '🔊', label: '말하는 중', color: 'text-emerald-600' },
    }[liveStatus];
    const userTurns = transcript.filter((l) => l.speaker === 'user').length;
    const lastOwner = [...transcript].reverse().find((l) => l.speaker === 'owner');

    return (
      <div className="mx-auto max-w-lg">
        {placeBar}
        <div className="flex min-h-[60vh] flex-col items-center justify-center py-8 text-center">
          <p className={`text-6xl`}>{statusView.icon}</p>
          <p className={`mt-3 text-2xl font-extrabold ${statusView.color}`}>{statusView.label}</p>

          {/* 마이크 레벨 — 마이크가 살아있는지 보이게 */}
          {voiceMode && (
            <div className="mt-3 h-2 w-48 overflow-hidden rounded-full bg-[#F2F4F6]">
              <div className="h-2 rounded-full bg-[#3182F6] transition-all duration-75" style={{ width: `${Math.round(micLevel * 100)}%` }} />
            </div>
          )}

          {/* 실시간 전사 (interim) / 사장님 마지막 말 */}
          <div className="mt-6 min-h-16 w-full max-w-md">
            {liveStatus === 'listening' && interim && (
              <p className={`text-lg ${INK}`}>“{interim}”</p>
            )}
            {liveStatus === 'speaking' && lastOwner && (
              <p className={`text-lg ${SUB}`}>사장님: “{lastOwner.text}”</p>
            )}
          </div>

          {/* 텍스트 폴백 입력 */}
          {!voiceMode && liveStatus === 'listening' && (
            <div className="mt-4 flex w-full max-w-md gap-2">
              <input
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && textInput.trim()) {
                    const line: UtterLine = { speaker: 'user', text: textInput.trim(), confidence: 1, lowConfidence: false };
                    setTranscript((prev) => [...prev, line]);
                    transcriptRef.current = [...transcriptRef.current, line];
                    setTextInput('');
                    void sendTurn(line.text);
                  }
                }}
                placeholder="사장님께 할 말을 입력하고 Enter"
                className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              />
            </div>
          )}

          {notice && <p className="mt-3 text-sm text-amber-700">{notice}</p>}

          {/* 힌트 — 누를 때만 후보 제시, 사용 횟수는 채점에 반영 */}
          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={() => void requestHint()}
              disabled={hintBusy || liveStatus !== 'listening'}
              className="rounded-full border border-slate-300 px-4 py-1.5 text-sm text-slate-600 disabled:opacity-40"
            >
              💡 힌트 {hintCount > 0 && `(${hintCount}회 사용)`}
            </button>
            <button onClick={() => void finishSession()} className="rounded-full border border-red-300 px-4 py-1.5 text-sm text-red-600">
              상담 종료
            </button>
            <span className="text-xs text-slate-400">{userTurns}/{MAX_USER_TURNS}턴</span>
          </div>
          {hints && (
            <div className="mt-3 w-full max-w-md space-y-1.5 text-left">
              {hints.map((h) => (
                <p key={h} className="rounded-xl bg-[#E8F3FF] px-3 py-2 text-sm text-slate-700">{h}</p>
              ))}
              <p className="text-xs text-slate-400">힌트 사용은 채점에 기록됩니다 — 참고만 하고 본인 말로 하세요.</p>
            </div>
          )}

          {/* 전체 전사는 접어둠 */}
          <button onClick={() => setShowTranscript((v) => !v)} className="mt-6 text-xs text-slate-400 underline">
            {showTranscript ? '전사 접기' : `전체 전사 보기 (${transcript.length})`}
          </button>
          {showTranscript && (
            <div className="mt-2 max-h-48 w-full max-w-md space-y-1 overflow-y-auto text-left text-xs">
              {transcript.map((l, i) => (
                <p key={i} className={l.speaker === 'user' ? INK : SUB}>
                  <b>{l.speaker === 'user' ? '나' : '사장님'}:</b> {l.text}
                  {l.lowConfidence && <span className="ml-1 text-amber-600">[인식 신뢰도 낮음]</span>}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ============ SCORING ============
  if (phase === 'scoring') {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center text-center">
        <p className="text-4xl">📋</p>
        <p className={`mt-3 text-xl font-bold ${INK}`}>채점 중…</p>
        <p className={`mt-1 text-sm ${SUB}`}>고정된 기준 5개에 대해 전사 인용과 함께 판정합니다</p>
      </div>
    );
  }

  // ============ REVIEW ============
  return (
    <div className="mx-auto max-w-lg space-y-4">
      {placeBar}
      {score?.status === 'ok' ? (
        <>
          <section className="rounded-2xl bg-[#191F28] p-6 text-center text-white">
            <p className="text-sm text-slate-300">종합 점수 (코드 합산 · 기준은 고정 rubric)</p>
            <p className="my-1 text-6xl font-extrabold">{score.score}</p>
            <p className="text-xs text-slate-400">
              힌트 {score.hintCount}회 사용{score.hintPenalty ? ` (−${score.hintPenalty}점)` : ''} · 인식 실패율{' '}
              {Math.round((score.recognitionFailRate ?? 0) * 100)}%
            </p>
            {score.lowReliability && (
              <p className="mt-2 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs text-amber-300">
                ⚠️ 인식 품질이 낮아 채점 신뢰도가 떨어집니다 — 아래에서 전사를 수정하고 재채점하세요.
              </p>
            )}
          </section>

          <section className="space-y-2">
            {(score.verdicts ?? []).map((v: CriterionVerdict) => (
              <div key={v.id} className="rounded-2xl border border-[#F2F4F6] bg-white p-4">
                <p className="text-sm font-semibold">
                  {v.met ? '✅' : '❌'} {v.question} <span className="text-xs text-slate-400">({v.weight}점)</span>
                </p>
                {v.quote && <p className="mt-1 rounded-lg bg-[#F9FAFB] px-2.5 py-1.5 text-xs text-slate-600">“{v.quote}”</p>}
                <p className="mt-1 text-xs text-slate-500">{v.reason}</p>
              </div>
            ))}
          </section>
        </>
      ) : score?.status === 'disabled' ? (
        <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">ANTHROPIC_API_KEY 대기 중 — 키가 들어오면 채점이 활성화됩니다.</p>
      ) : (
        <p className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{score?.message ?? '채점 실패'}</p>
      )}

      {/* 전사 리뷰 + 수정 → 재채점 (인식 오류가 채점을 오염시키지 않게) */}
      <section className="rounded-2xl border border-[#F2F4F6] bg-white p-4">
        <p className="mb-2 text-sm font-semibold">전사 — 잘못 인식된 부분을 고치면 다시 채점합니다</p>
        <div className="space-y-2">
          {editedTranscript.map((l, i) =>
            l.speaker === 'user' ? (
              <div key={i}>
                <p className="text-xs text-slate-400">
                  나{l.lowConfidence && <span className="ml-1 text-amber-600">[인식 신뢰도 낮음 — 채점 근거 제외됨]</span>}
                  {typeof l.confidence === 'number' && <span className="ml-1">conf {l.confidence}</span>}
                </p>
                <textarea
                  value={l.text}
                  onChange={(e) => {
                    const next = [...editedTranscript];
                    // 사용자가 직접 수정한 발화는 신뢰 — 저신뢰 플래그 해제
                    next[i] = { ...l, text: e.target.value, lowConfidence: false };
                    setEditedTranscript(next);
                  }}
                  rows={2}
                  className={`w-full rounded-xl border px-3 py-2 text-sm ${l.lowConfidence ? 'border-amber-400 bg-amber-50' : 'border-slate-200'}`}
                />
              </div>
            ) : (
              <p key={i} className="text-sm text-slate-500">
                <b>사장님:</b> {l.text}
              </p>
            ),
          )}
        </div>
        <button
          onClick={() => {
            setPhase('scoring');
            void requestScore(editedTranscript);
          }}
          className="mt-3 w-full rounded-2xl bg-[#3182F6] py-2.5 text-sm font-bold text-white"
        >
          수정 반영해 재채점
        </button>
      </section>

      <div className="flex gap-2">
        <button onClick={() => setPhase('setup')} className="flex-1 rounded-2xl border border-slate-300 py-2.5 text-sm">
          같은 사업장으로 다시 연습
        </button>
        <Link href="/places" className="flex-1 rounded-2xl border border-slate-300 py-2.5 text-center text-sm">
          다른 사업장 고르기
        </Link>
      </div>
    </div>
  );
}
