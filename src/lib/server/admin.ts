/**
 * 관리자 판별 — 환경변수 ADMIN_EMAILS(쉼표 구분) 화이트리스트.
 * 새 인증 체계를 만들지 않는다 — 기존 JWT 세션의 이메일로만 판별 (2026-08-14 지시).
 * 비관리자에게는 404를 반환한다 (403 대신 — 경로 존재 자체를 노출하지 않기 위해).
 * URL 시크릿(?key=) 방식 기각: 히스토리·리퍼러에 남는다 (README 기록).
 */

export function isAdminEmail(email: string | null): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}
