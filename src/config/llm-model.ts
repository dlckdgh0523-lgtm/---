/**
 * LLM 모델 선택 — 한 곳에서 관리 (2026-08-14).
 *
 * opus-5에서 sonnet-5로 낮춘 이유:
 * - opus는 이 작업(짧은 접근 문장·페르소나 대화·rubric 판정)에 과하다. 비용이 크고 지연이 길다
 *   (롤플레잉 대화가 opus에서 ~20초씩 걸렸다 — 실시간 음성 대화에 부적합).
 * - sonnet-5는 opus보다 빠르고 저렴하며, output_config(effort·json_schema) 파라미터를 동일하게 지원한다.
 * - haiku는 더 빠르지만 effort/구조화 출력 파라미터 호환을 이 코드에서 검증하지 못해 보류
 *   (실시간 대화만 haiku로 더 낮추는 것은 파라미터 확인 후 별도 결정).
 */
export const LLM_MODEL = 'claude-sonnet-5';
