/**
 * 전국 행정구역(시도/시군구) 목록.
 *
 * ⚠️ 이 목록은 손으로 작성하지 않았다 — 소상공인 상가(상권)정보 CSV(공단 원천)에서
 * scripts/extract-regions.ts로 추출했다 (행정구역·코드 추측 기재 금지 원칙).
 * 갱신: 원천 CSV 교체 후 `npx tsx scripts/extract-regions.ts` 재실행.
 */
import generated from './regions.generated.json';

export interface SigunguOption {
  code: string; // 시군구코드 5자리 — 데이터 팩 키 + 건축HUB sigunguCd
  name: string;
}

export interface SidoOption {
  code: string; // 시도코드 2자리
  name: string;
  sigungu: SigunguOption[];
}

export const SIDO_LIST: SidoOption[] = generated.sido;

/** 시군구코드 → { sido, sigungu }. 없는 코드면 null */
export function findRegion(sigunguCode: string): { sido: SidoOption; sigungu: SigunguOption } | null {
  for (const sido of SIDO_LIST) {
    const sigungu = sido.sigungu.find((s) => s.code === sigunguCode);
    if (sigungu) return { sido, sigungu };
  }
  return null;
}

/** "서울특별시 용산구" 형태 라벨. 미등록 코드는 코드 그대로 반환 */
export function regionLabel(sigunguCode: string): string {
  const found = findRegion(sigunguCode);
  return found ? `${found.sido.name} ${found.sigungu.name}` : sigunguCode;
}
