/** 메일 하단 수신 해제 링크 — 구독 저장소에서 제거 (계정과 무관, 기존 이메일 파라미터 방식 유지). */
import { NextRequest } from 'next/server';
import { unsubscribe } from '@/lib/server/subscribers';

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email') ?? '';
  const removed = email ? await unsubscribe(email) : false;
  const html = `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:48px;text-align:center;color:#191F28;">
  <h2>${removed ? '수신이 해제되었습니다' : '등록되지 않은 주소입니다'}</h2>
  <p style="color:#4E5968;">다시 받으려면 앱의 설정 화면에서 구독을 등록하세요.</p></body>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
