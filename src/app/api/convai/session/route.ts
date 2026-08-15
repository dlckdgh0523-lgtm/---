/**
 * /api/convai/session — 방식 B(음성-음성 직결)용 세션 발급.
 *
 * - 키는 서버에서만 사용한다(ELEVENLABS_API_KEY). 에이전트는 ELEVENLABS_AGENT_ID.
 * - ElevenLabs Conversational AI의 서명 URL을 발급하고, 사업장별 페르소나 프롬프트를 함께 준다.
 *   (클라이언트가 startSession 시 overrides로 프롬프트를 지정 — 에이전트에서 override 허용됨.)
 * - 키/에이전트가 없거나 발급 실패면 status를 알려 클라이언트가 선택 화면으로 되돌리게 한다.
 * - 여기서는 상태 관리·가드·채점을 붙이지 않는다(방식 B의 목적은 자연스러움 비교).
 */
import { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/server/session';
import { loadPlaceContext } from '@/lib/server/place-context';

const AGENT_ID = process.env.ELEVENLABS_AGENT_ID;

export async function POST(req: NextRequest) {
  const email = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!email) return new Response('unauthorized', { status: 401 });

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key || !AGENT_ID) return Response.json({ status: 'disabled' });

  const body = (await req.json().catch(() => ({}))) as { region?: string; placeId?: string };

  // 서명 URL 발급 (키는 서버에만)
  let signedUrl = '';
  try {
    const r = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${AGENT_ID}`,
      { headers: { 'xi-api-key': key }, signal: AbortSignal.timeout(10000) },
    );
    if (!r.ok) {
      // 401 인증 / 429 크레딧(15분 소진) 등 → 클라이언트가 사유 표시
      return Response.json({ status: 'error', code: r.status });
    }
    signedUrl = ((await r.json()) as { signed_url: string }).signed_url;
  } catch {
    return Response.json({ status: 'error', code: 0 });
  }

  // 사업장별 페르소나 (시스템 프롬프트 override용)
  let prompt =
    '너는 한국의 작은 가게 사장님이다. 보험설계사가 처음 찾아온 상황이다. 짧고 자연스러운 한국어 구어체로 답한다.';
  const firstMessage = '네, 어서 오세요. 무슨 일이세요?';
  if (body.region && body.placeId) {
    const loaded = loadPlaceContext(body.region, body.placeId);
    if (loaded) {
      const c = loaded.context;
      prompt = `너는 '${loaded.place.name}'의 사장님이다. 업종은 ${c.industry}${c.subCategory ? ` (${c.subCategory})` : ''}, 개업 ${c.elapsedMonths}개월 됐다. 보험설계사가 가게에 처음 찾아온 상황의 롤플레잉이다. 짧고 자연스러운 한국어 구어체로 답한다(보통 한두 문장). 처음 보는 사람이라 살짝 시큰둥하지만 무례하진 않다. 상대가 방문 이유(용건)를 밝히기 전에는 자세히 응하지 않는다. 매출·가족·법령·보험 상품 지식을 지어내지 않는다. 대화가 계속 겉돌면 자연스럽게 마무리한다.`;
    }
  }

  return Response.json({ status: 'ok', signedUrl, prompt, firstMessage, language: 'ko' });
}
