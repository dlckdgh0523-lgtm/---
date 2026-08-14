/** 금액(만원 단위) 표시 */
export function man(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}만`;
}

export function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
