/** 메일 본문 렌더 — HTML과 텍스트 양쪽 제공 (지시 요구). 개인 금액 데이터 없음 — 접점 정보만. */
import type { NotifyPayload } from './types';

export function renderSubject(p: NotifyPayload): string {
  return `[인톡] ${p.dateLabel} 오늘의 접점 ${p.picks.length}곳 — ${p.regionName}`;
}

export function renderText(p: NotifyPayload): string {
  const lines = p.picks.map(
    (x, i) =>
      `${i + 1}. ${x.name} (${x.category}) — ${x.address}\n   ${x.groupLabel}${x.anniversary ? ` ${x.anniversary}주년` : ''} · 경과 ${x.elapsed}개월 (${x.stageLabel}) · 업종 24개월 폐업률 ${Math.round(x.industryClosure24 * 100)}%${x.closureSource === 'average' ? '(평균 추정)' : ''}`,
  );
  return [
    `${p.dateLabel} 오늘의 접점 — ${p.regionName}`,
    '',
    ...lines,
    '',
    p.summaryLine,
    '',
    `지도에서 보기: ${p.mapUrl}`,
    `수신 해제: ${p.unsubscribeUrl}`,
  ].join('\n');
}

export function renderHtml(p: NotifyPayload): string {
  const rows = p.picks
    .map(
      (x, i) => `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid #F2F4F6;">
          <div style="font-weight:700;color:#191F28;">${i + 1}. ${x.name} <span style="font-weight:400;color:#8B95A1;font-size:12px;">${x.category}</span></div>
          <div style="color:#4E5968;font-size:13px;margin-top:2px;">${x.address}</div>
          <div style="font-size:12px;margin-top:4px;color:#3182F6;font-weight:600;">
            ${x.groupLabel}${x.anniversary ? ` · ${x.anniversary}주년` : ''} · 경과 ${x.elapsed}개월(${x.stageLabel}) · 업종 폐업률 ${Math.round(x.industryClosure24 * 100)}%${x.closureSource === 'average' ? ' (평균 추정)' : ''}
          </div>
        </td>
      </tr>`,
    )
    .join('');
  return `
  <div style="font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif;background:#F9FAFB;padding:24px;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #F2F4F6;">
      <div style="padding:20px 16px;background:#191F28;color:#fff;">
        <div style="font-size:12px;color:#4E9EFF;font-weight:700;">인톡 | 이창호 사전과제</div>
        <div style="font-size:18px;font-weight:800;margin-top:4px;">${p.dateLabel} 오늘의 접점 — ${p.regionName}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
      <div style="padding:14px 16px;color:#4E5968;font-size:12px;background:#F9FAFB;">${p.summaryLine}</div>
      <div style="padding:16px;text-align:center;">
        <a href="${p.mapUrl}" style="display:inline-block;background:#3182F6;color:#fff;text-decoration:none;font-weight:700;padding:12px 28px;border-radius:12px;">지도에서 보기</a>
      </div>
      <div style="padding:12px 16px;color:#8B95A1;font-size:11px;text-align:center;border-top:1px solid #F2F4F6;">
        업종별 폐업률은 지역 인허가 데이터 실측값이며, 접촉 우선순위는 현장 경험 기반 가설입니다.<br/>
        <a href="${p.unsubscribeUrl}" style="color:#8B95A1;">수신 해제</a>
      </div>
    </div>
  </div>`;
}
