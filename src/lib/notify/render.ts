/**
 * 메일 본문 렌더 — HTML과 텍스트 양쪽. 개인 금액 데이터 없음 — 접점 정보만.
 * 2026-08-14 개선(사용자 피드백: "1곳만 보이고 불친절"): 인사말 + 접점 5곳 전부 카드형 +
 * 그룹별 접근 팁 + 명확한 CTA(지도 링크). 이메일 클리핑을 피하려 인라인 스타일을 간결하게.
 */
import type { NotifyPayload } from './types';
import type { TodayPick } from '@/lib/today-picks';

export function renderSubject(p: NotifyPayload): string {
  const first = p.picks[0]?.name ?? '';
  return `[인톡] ${p.dateLabel} 오늘 가볼 접점 ${p.picks.length}곳 (${first}${p.picks.length > 1 ? ' 외' : ''})`;
}

/** 그룹별 접근 팁 — 왜 오늘 이 사업장을 가는지 한 줄 (현장 경험 아님, 데이터·경과 기반) */
function approachTip(pick: TodayPick): string {
  if (pick.groupLabel.includes('우선')) return '개업 초기예요. 부담 주지 말고 얼굴만 익힌다는 마음으로 짧게 인사하세요.';
  if (pick.groupLabel.includes('주년')) return `${pick.anniversary ?? ''}주년 즈음이라 갱신·재점검 이야기를 자연스럽게 꺼내기 좋아요.`;
  if (pick.groupLabel.includes('전환')) return '최근 새로 시작한 자리로 보여요. 이전 업력과 무관한 새 접점입니다.';
  return '오래 유지해온 곳이에요. 안부부터 편하게.';
}

export function renderText(p: NotifyPayload): string {
  const lines = p.picks.map(
    (x, i) =>
      `${i + 1}. ${x.name} (${x.category})\n   ${x.address}\n   ${x.groupLabel}${x.anniversary ? ` ${x.anniversary}주년` : ''} · 개업 ${x.elapsed}개월 · 업종 24개월 폐업률 ${Math.round(x.industryClosure24 * 100)}%${x.closureSource === 'average' ? '(평균 추정)' : ''}\n   팁: ${approachTip(x)}`,
  );
  return [
    `안녕하세요, 오늘 가볼 만한 접점 ${p.picks.length}곳을 골랐어요 — ${p.dateLabel}, ${p.regionName}`,
    '',
    ...lines,
    '',
    p.summaryLine,
    '',
    `방문 팁: 사업주 접점은 매장이 한산할 때가 좋아요. 혼잡 시간대는 피하세요.`,
    '',
    `지도에서 위치와 상세를 보려면 → ${p.mapUrl}`,
    `수신 해제: ${p.unsubscribeUrl}`,
  ].join('\n');
}

export function renderHtml(p: NotifyPayload): string {
  const cards = p.picks
    .map(
      (x, i) => `
      <div style="border:1px solid #F2F4F6;border-radius:12px;padding:14px 16px;margin:0 16px 10px;">
        <div style="font-weight:700;color:#191F28;font-size:15px;">${i + 1}. ${x.name}
          <span style="font-weight:400;color:#8B95A1;font-size:12px;">${x.category}</span>
        </div>
        <div style="color:#4E5968;font-size:13px;margin-top:3px;">📍 ${x.address}</div>
        <div style="font-size:12px;margin-top:6px;">
          <span style="display:inline-block;background:#E8F3FF;color:#3182F6;font-weight:600;border-radius:6px;padding:2px 8px;">${x.groupLabel}${x.anniversary ? ` · ${x.anniversary}주년` : ''}</span>
          <span style="color:#8B95A1;margin-left:6px;">개업 ${x.elapsed}개월 · 업종 폐업률 ${Math.round(x.industryClosure24 * 100)}%${x.closureSource === 'average' ? ' (평균 추정)' : ''}</span>
        </div>
        <div style="font-size:12px;color:#4E5968;margin-top:8px;background:#F9FAFB;border-radius:8px;padding:8px 10px;">
          💡 ${approachTip(x)}
        </div>
      </div>`,
    )
    .join('');

  return `
  <div style="font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif;background:#F9FAFB;padding:24px 0;">
    <div style="max-width:580px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #F2F4F6;">
      <div style="padding:22px 16px;background:#191F28;color:#fff;">
        <div style="font-size:12px;color:#4E9EFF;font-weight:700;">인톡 · 오늘의 접점</div>
        <div style="font-size:19px;font-weight:800;margin-top:6px;">안녕하세요 👋 오늘 가볼 만한 곳 ${p.picks.length}곳을 골랐어요</div>
        <div style="font-size:13px;color:#B0B8C1;margin-top:4px;">${p.dateLabel} · ${p.regionName}</div>
      </div>

      <div style="padding:16px 0 4px;">${cards}</div>

      <div style="margin:6px 16px 0;padding:12px 14px;background:#FFF8E1;border-radius:10px;font-size:12px;color:#7A5C00;">
        🕒 <b>방문 팁</b> — 사업주 접점은 매장이 <b>한산할 때</b>가 좋아요. 혼잡 시간대는 피하고, 첫 방문은 인사만 짧게.
      </div>

      <div style="padding:14px 16px;color:#4E5968;font-size:12px;">${p.summaryLine}</div>

      <div style="padding:8px 16px 20px;text-align:center;">
        <a href="${p.mapUrl}" style="display:inline-block;background:#3182F6;color:#fff;text-decoration:none;font-weight:700;padding:13px 30px;border-radius:12px;font-size:15px;">지도에서 위치·상세 보기 →</a>
        <div style="font-size:11px;color:#8B95A1;margin-top:8px;">각 사업장의 존속 위험·건축물대장·첫 접근 멘트는 앱에서 확인하세요.</div>
      </div>

      <div style="padding:12px 16px;color:#8B95A1;font-size:11px;text-align:center;border-top:1px solid #F2F4F6;">
        업종별 폐업률은 지역 인허가 데이터 실측값이며, 접촉 우선순위는 현장 경험 기반 가설입니다.<br/>
        <a href="${p.unsubscribeUrl}" style="color:#8B95A1;">수신 해제</a>
      </div>
    </div>
  </div>`;
}
