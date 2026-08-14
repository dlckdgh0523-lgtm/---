'use client';

/**
 * 수수료 구조(선지급률·환수 구간) 편집 — /settings C 섹션에 배치되는 제어 컴포넌트.
 * (2026-08-13 화면 개편: 자체 저장 버튼을 없애고 settings 페이지가 상태를 소유한다)
 *
 * 설계 원칙 (MEMORY.md 2026-08-13):
 * - 기본값이 미리 채워진 상태로 보여주고 입력을 강제하지 않는다.
 * - 항목명을 단정하지 않는다 — 표기는 소속사마다 다르지만 본인 급여이므로
 *   사용자는 자기 명세서에서 찾을 수 있다. 개념으로만 설명한다.
 * - 사용자가 건드린 값만 source='user'로 승격 (부모가 onTouch로 기록).
 */
import type { AgentProfile, ClawbackBracket } from '@/types';
import { pct } from '@/lib/format';

interface Props {
  advanceRate: number;
  schedule: ClawbackBracket[];
  source: AgentProfile['structureSource'];
  onAdvanceRateChange: (v: number) => void;
  onScheduleChange: (s: ClawbackBracket[]) => void;
}

export function SourceBadge({ source }: { source: 'default' | 'user' }) {
  return source === 'default' ? (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">기본값 사용 중</span>
  ) : (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">내 조건 반영됨</span>
  );
}

export default function StructureEditor({ advanceRate, schedule, source, onAdvanceRateChange, onScheduleChange }: Props) {
  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-slate-500">
        수수료 명세서(급여명세)를 옆에 펴놓고 찾아 입력하면 결과가 추정치에서 내 조건 기준으로 바뀝니다. 항목 이름은
        소속사마다 다르지만, 본인 급여이므로 명세서에서 찾을 수 있습니다. 모르면 기본값 그대로 두세요.
      </p>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">
            선지급률: <b>{pct(advanceRate)}</b>
          </p>
          <SourceBadge source={source.advanceRate} />
        </div>
        <p className="mb-2 mt-0.5 text-xs leading-relaxed text-slate-500">
          찾을 것: 이번 달 신계약 수수료 중 <b>먼저 지급된 비율</b>. 선지급·선급 등 선지급과 관련된 항목과 총
          모집수수료를 비교하세요 — 실제 표기는 다를 수 있습니다.
        </p>
        <input
          type="range"
          min={0.3}
          max={0.9}
          step={0.05}
          value={advanceRate}
          onChange={(e) => onAdvanceRateChange(Number(e.target.value))}
          className="w-full accent-[#3182F6]"
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">환수 구간 (유지 개월수별 환수율)</p>
          <SourceBadge source={source.clawbackSchedule} />
        </div>
        <p className="mb-2 mt-0.5 text-xs leading-relaxed text-slate-500">
          찾을 것: 계약이 일찍 해지될 때 <b>돌려줘야 하는 비율의 기준표</b>. 환수·미경과 등으로 표기된 항목이나
          위촉계약서의 환수 관련 조항에 있습니다 — 실제 표기는 다를 수 있습니다. 못 찾겠으면 지원단·총무팀에 "내 환수
          기준표"를 요청하는 것이 가장 빠릅니다.
        </p>
        <div className="space-y-2">
          {schedule.map((b, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">유지</span>
              <input
                type="number"
                min={1}
                value={b.maxMonth}
                onChange={(e) => {
                  const next = schedule.map((x) => ({ ...x }));
                  next[i].maxMonth = Number(e.target.value) || 0;
                  onScheduleChange(next);
                }}
                className="w-16 rounded border border-slate-300 bg-white px-2 py-1 text-right"
              />
              <span className="text-slate-500">개월 이하 해지 시</span>
              <input
                type="number"
                min={0}
                max={100}
                value={Math.round(b.clawbackRate * 100)}
                onChange={(e) => {
                  const next = schedule.map((x) => ({ ...x }));
                  next[i].clawbackRate = (Number(e.target.value) || 0) / 100;
                  onScheduleChange(next);
                }}
                className="w-16 rounded border border-slate-300 bg-white px-2 py-1 text-right"
              />
              <span className="text-slate-500">% 환수</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-amber-700">⚠️ 기본값은 예시이며 실제 환수 조건은 소속사·상품별로 다릅니다.</p>
      </div>
    </div>
  );
}
