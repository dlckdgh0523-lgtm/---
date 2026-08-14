/**
 * LLM 모델 — 복잡도 기반 분기 (2026-08-14, 단일 모델 통일 폐기).
 *
 * 배치 근거(감이 아니라 eval 통과율·지연 실측으로 결정 — README 상세):
 *   FAST(haiku)    : 지연이 UX를 좌우하고 수치 인용이 없는 곳. 롤플레잉 대화·힌트.
 *                    실측: 롤플레잉 턴 sonnet 2.9s. haiku는 더 빠름. 페르소나 연기는 수치 정확도 요구 낮음.
 *   ACCURATE(opus) : 수치를 그대로 인용해야 하고(근거 화이트리스트) 지연 무관한 곳. 접근 시나리오·채점.
 *                    실측: sonnet이 폐업률 16%→15%, 18%→17% 근사(eval 감지). opus는 정확.
 *   BALANCED(sonnet): eval 심사자. 심사자가 흔들리면 평가가 무의미하므로 sonnet 이상 고정.
 *
 * ⚠️ haiku는 output_config의 effort 파라미터를 지원하지 않는다(400, 2026-08-14 실호출 확인).
 *    effort 없이 json_schema·스트리밍은 정상. 그래서 outputConfig() 헬퍼가 모델별로 effort를 뺀다.
 *    추측이 아니라 실호출로 확인한 사실.
 */
export const LLM_MODEL_FAST = 'claude-haiku-4-5'; // 롤플레잉 대화, 힌트
export const LLM_MODEL_BALANCED = 'claude-sonnet-5'; // eval 심사자
export const LLM_MODEL_ACCURATE = 'claude-opus-5'; // 접근 시나리오, 채점

/** effort 지원 여부 — haiku만 미지원 (실호출 확인) */
export function supportsEffort(model: string): boolean {
  return !model.includes('haiku');
}

type Effort = 'low' | 'medium' | 'high';
interface OutputConfigOpts {
  effort?: Effort;
  format?: unknown; // json_schema 등
}

/** 모델에 맞는 output_config 구성 — haiku면 effort를 자동으로 제외한다 */
export function outputConfig(model: string, opts: OutputConfigOpts): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};
  if (opts.effort && supportsEffort(model)) cfg.effort = opts.effort;
  if (opts.format) cfg.format = opts.format;
  return cfg;
}
