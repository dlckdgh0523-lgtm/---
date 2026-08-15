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
  const [speakingText, setSpeakingText] = useState(''); // 현재 TTS 재생 중인 문장 (강조용)
  const [micLevel, setMicLevel] = useState(0);
  const [transcript, setTranscript] = useState<UtterLine[]>([]);
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
  const busyRef = useRef(false); // 생각 중/말하는 중 — STT 재시작·이중 전송 차단
  const endedRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

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

  // 대화 스레드 자동 스크롤 (항상 하단 고정)
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript, interim, liveStatus]);

  // ---------- TTS ----------
  // 음성 목록은 비동기 로드 — 첫 호출 시 빈 배열일 수 있어 voiceschanged로 갱신 (A-2).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const load = () => window.speechSynthesis.getVoices();
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

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
        speakingRef.current = false;
        setSpeakingText('');
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
      // 크롬은 무음이 이어지면 인식을 자동 종료한다 → '듣는 중'일 때만 재시작.
      // 생각 중/말하는 중(busyRef)에는 재시작하지 않는다 — 이중 전송·에코 방지.
      if (sessionActiveRef.current && !speakingRef.current && !busyRef.current) {
        setTimeout(() => {
          try {
            if (sessionActiveRef.current && !speakingRef.current && !busyRef.current) rec.start();
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

  // 문장 배열을 순서대로 읽는다. TTS가 차단(제스처 없음)되거나 무음이어도 멈추지 않도록
  // 문장마다 안전 타이머로 다음으로 넘어간다 (A-2). 텍스트는 이미 화면에 떠 있으므로 소리는 보조.
  const speakSentences = useCallback(
    (sentences: string[], onAllDone: () => void) => {
      speakingRef.current = true;
      if (!bargeInRef.current) stopRecognition(); // 에코 방지: 재생 중 STT 중지
      setLiveStatus('speaking');
      let i = 0;
      const step = () => {
        if (i >= sentences.length) {
          speakingRef.current = false;
          setSpeakingText('');
          onAllDone();
          return;
        }
        const sentence = sentences[i++];
        setSpeakingText(sentence); // 현재 재생 문장 강조
        let advanced = false;
        const go = () => {
          if (advanced) return;
          advanced = true;
          step();
        };
        try {
          const u = new SpeechSynthesisUtterance(sentence);
          u.lang = 'ko-KR';
          const voice = pickKoVoice();
          if (voice) u.voice = voice;
          u.onend = go;
          u.onerror = go;
          window.speechSynthesis.speak(u);
        } catch {
          go();
          return;
        }
        // 안전 타이머: onend가 오지 않거나(무음/차단) 유실돼도 대화가 멈추지 않게 진행.
        // 실제 발화는 이보다 빨리 끝나 onend가 먼저 진행한다.
        setTimeout(go, Math.max(2000, sentence.length * 220 + 1500));
      };
      step();
    },
    [pickKoVoice, stopRecognition],
  );

  // ---------- 턴 전송 ----------
  // route는 완결된 텍스트(비스트리밍)를 반환한다. 스트림 리더 대신 res.text()로 받아
  // 단계별로 로깅하고, 사장님 대사는 음성/텍스트 모드 공통으로 항상 말풍선에 남긴다(A-1·A-5).
  const sendTurn = useCallback(
    async (userText: string) => {
      setLiveStatus('thinking');
      setInterim('');
      busyRef.current = true; // 생각 중 — STT 재시작/이중 전송 차단
      const history = transcriptRef.current.map((l) => ({ speaker: l.speaker, text: l.text }));

      const finishTurn = () => {
        busyRef.current = false;
        if (endedRef.current || transcriptRef.current.filter((l) => l.speaker === 'user').length >= MAX_USER_TURNS) {
          void finishSession();
          return;
        }
        setLiveStatus('listening');
        utterFinalsRef.current = [];
        if (voiceMode) startRecognition();
      };

      let raw = '';
      let status = 0;
      try {
        const res = await fetch('/api/llm/roleplay/turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ region, placeId: place?.id, difficulty, ageIdx, temperIdx, history, userText }),
        });
        status = res.status;
        raw = await res.text();
      } catch (e) {
        console.warn('[roleplay] fetch 실패:', e);
        setNotice('네트워크 오류 — 사장님에게 말이 전달되지 않았습니다. 다시 시도하세요.');
        finishTurn();
        return;
      }
      console.log('[roleplay] sendTurn userText:', JSON.stringify(userText), '| status:', status, '| raw:', JSON.stringify(raw));

      if (status !== 200) {
        setNotice(`서버 오류(상태 ${status})로 응답을 받지 못했습니다. 다시 시도하세요.`);
        finishTurn();
        return;
      }

      const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
      console.log('[roleplay] 파싱된 라인:', lines);

      if (lines.includes('__DISABLED__')) {
        setNotice('ANTHROPIC_API_KEY 대기 중 — 키가 들어오면 대화가 활성화됩니다.');
        busyRef.current = false;
        sessionActiveRef.current = false;
        setPhase('setup');
        return;
      }
      if (lines.includes('__RATELIMIT__')) {
        setNotice('오늘 대화 한도에 도달했습니다.');
        busyRef.current = false;
        void finishSession();
        return;
      }
      if (lines.includes('__ERROR__')) {
        setNotice('사장님 응답 생성에 실패했습니다(모델 오류). 한 번 더 말해보세요.');
        finishTurn();
        return;
      }

      const ended = lines.includes('__END__');
      if (ended) endedRef.current = true;

      // 대사 = 마커(__...__)를 제외한 라인들
      const sentences = lines.filter((l) => !l.startsWith('__'));
      const ownerText = sentences.join(' ');
      const onlyEllipsis = sentences.length === 1 && sentences[0] === '...';
      console.log('[roleplay] 사장님 문장:', sentences, '| ended:', ended, '| onlyEllipsis:', onlyEllipsis);

      // A-3: 빈 응답 — 원인을 구분해 표시
      if (sentences.length === 0 || onlyEllipsis) {
        const reason = onlyEllipsis
          ? '사장님 대답이 출력 필터에 전량 제거됐습니다(법령·금지 표현 등). 표현을 바꿔 다시 말해보세요.'
          : '사장님 응답이 비어 있습니다(모델이 대사를 내지 않음). 다시 말해보세요.';
        console.warn('[roleplay] 빈 사장님 응답 —', onlyEllipsis ? '필터 전량 제거' : '빈 응답', '| raw:', JSON.stringify(raw));
        setNotice(reason);
        finishTurn();
        return;
      }

      // 사장님 대사를 화면에 남긴다 (음성·텍스트 공통, TTS와 무관)
      const ownerLine: UtterLine = { speaker: 'owner', text: ownerText };
      setTranscript((prev) => [...prev, ownerLine]);
      transcriptRef.current = [...transcriptRef.current, ownerLine];

      if (voiceMode) {
        speakSentences(sentences, finishTurn); // 소리는 보조 — 실패해도 텍스트는 이미 떠 있다
      } else {
        finishTurn();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [region, place, difficulty, ageIdx, temperIdx, voiceMode, speakSentences, startRecognition],
  );

  const commitUtterance = useCallback(() => {
    if (busyRef.current) {
      console.log('[roleplay] commitUtterance 건너뜀 — busy(생각/말하는 중)');
      return; // 생각 중/말하는 중이면 새 발화를 보내지 않는다 (이중 전송 방지)
    }
    const finals = utterFinalsRef.current;
    if (finals.length === 0) return;
    utterFinalsRef.current = [];
    const text = finals.map((f) => f.text).join(' ').trim();
    console.log('[roleplay] commitUtterance finals:', finals, '→ text:', JSON.stringify(text));
    if (!text) {
      console.log('[roleplay] commitUtterance 빈 텍스트 — 전송 안 함');
      return;
    }
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

    const submitText = () => {
      const text = textInput.trim();
      if (!text || liveStatus !== 'listening') return;
      const line: UtterLine = { speaker: 'user', text, confidence: 1, lowConfidence: false };
      setTranscript((prev) => [...prev, line]);
      transcriptRef.current = [...transcriptRef.current, line];
      setTextInput('');
      void sendTurn(text);
    };

    return (
      <div className="mx-auto max-w-lg">
        {placeBar}
        <div className="flex flex-col py-4">
          {/* 상태 표시 — 듣는 중/생각 중/말하는 중을 색·형태·움직임으로 구분 (A-4) */}
          <div className="flex flex-col items-center gap-1.5 py-1">
            <div className="flex items-center gap-2">
              <span className={liveStatus === 'thinking' ? 'animate-pulse text-2xl' : 'text-2xl'}>{statusView.icon}</span>
              <span className={`text-sm font-bold ${statusView.color}`}>{statusView.label}</span>
              {liveStatus === 'thinking' && (
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500" />
                </span>
              )}
            </div>
            {/* 듣는 중: 마이크 입력 레벨 실시간 — 소리 없이도 마이크가 살아있음을 보이게 */}
            {voiceMode && liveStatus === 'listening' && (
              <span className="inline-block h-1.5 w-40 overflow-hidden rounded-full bg-[#F2F4F6]">
                <span className="block h-1.5 rounded-full bg-[#3182F6] transition-all duration-75" style={{ width: `${Math.round(micLevel * 100)}%` }} />
              </span>
            )}
            {/* 말하는 중: 현재 재생 문장 강조 — 소리가 안 들려도 어느 문장인지 보이게 */}
            {liveStatus === 'speaking' && speakingText && (
              <span className="max-w-md rounded-full bg-emerald-50 px-3 py-1 text-center text-xs text-emerald-700">🔊 {speakingText}</span>
            )}
          </div>

          {/* 대화 스레드 — 항상 보임. 말하면 사장님 답이 여기에 이어진다 */}
          <div ref={threadRef} className="mt-2 max-h-[50vh] min-h-[38vh] space-y-2 overflow-y-auto rounded-2xl bg-[#F9FAFB] p-4">
            {transcript.length === 0 && liveStatus !== 'thinking' && (
              <p className="py-10 text-center text-sm text-slate-400">
                {voiceMode ? '말을 걸어보세요. 사장님이 대답합니다.' : '아래에 할 말을 입력하고 Enter를 누르세요. 사장님이 대답합니다.'}
              </p>
            )}
            {transcript.map((l, i) => (
              <div key={i} className={l.speaker === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    l.speaker === 'user' ? 'bg-[#3182F6] text-white' : 'border border-[#EDF0F3] bg-white text-[#191F28]'
                  }`}
                >
                  <span className="mb-0.5 block text-[11px] opacity-60">{l.speaker === 'user' ? '나' : '사장님'}</span>
                  {l.text}
                  {l.lowConfidence && <span className="ml-1 text-[10px] text-amber-500">[인식 신뢰도 낮음]</span>}
                </div>
              </div>
            ))}
            {liveStatus === 'listening' && interim && (
              <div className="flex justify-end">
                <div className="max-w-[82%] rounded-2xl border border-dashed border-[#3182F6] px-3.5 py-2 text-sm text-[#3182F6]">{interim}</div>
              </div>
            )}
            {liveStatus === 'thinking' && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-[#EDF0F3] bg-white px-3.5 py-2 text-sm text-slate-400">사장님이 생각 중…</div>
              </div>
            )}
          </div>

          {/* 입력 (텍스트 모드) — 항상 보이고 응답 처리 중엔 잠시 비활성 */}
          {!voiceMode && (
            <div className="mt-3 flex gap-2">
              <input
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitText();
                }}
                disabled={liveStatus !== 'listening'}
                placeholder={liveStatus === 'listening' ? '사장님께 할 말을 입력하고 Enter' : '사장님이 대답하는 중…'}
                className="flex-1 rounded-2xl border border-slate-300 px-4 py-3 text-sm disabled:bg-slate-50 disabled:text-slate-400"
              />
              <button
                onClick={submitText}
                disabled={liveStatus !== 'listening' || !textInput.trim()}
                className="rounded-2xl bg-[#3182F6] px-5 text-sm font-bold text-white disabled:bg-slate-300"
              >
                전송
              </button>
            </div>
          )}

          {notice && <p className="mt-2 text-center text-sm text-amber-700">{notice}</p>}

          {/* 힌트 / 종료 */}
          <div className="mt-4 flex items-center justify-center gap-3">
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
            <div className="mt-3 space-y-1.5 text-left">
              {hints.map((h) => (
                <button
                  key={h}
                  onClick={() => {
                    if (!voiceMode) setTextInput(h);
                  }}
                  className="block w-full rounded-xl bg-[#E8F3FF] px-3 py-2 text-left text-sm text-slate-700"
                >
                  {h}
                </button>
              ))}
              <p className="text-xs text-slate-400">힌트는 참고용입니다. 그대로 쓰기보다 본인 말로 바꿔 말하세요(사용 횟수는 채점에 기록).</p>
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
