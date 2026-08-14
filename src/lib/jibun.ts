/**
 * 지번주소 → 건축HUB 건축물대장 API 파라미터 파싱.
 *
 * API: apis.data.go.kr/1613000/BldRgstHubService (번지 단위 조회, 일 10,000건 제한)
 * 파라미터: sigunguCd(5), bjdongCd(5), platGbCd(0 대지/1 산/2 블록), bun(4자리 zero-pad), ji(4자리 zero-pad)
 *
 * 법정동코드는 추측하지 않는다 — 지역 팩의 bjdong.json(상가정보 원천에서 추출,
 * 법정동코드 10자리 = 시군구 5 + 법정동 5)을 기준으로 동 이름 → 코드 매핑.
 * 실제 API 호출 검증은 인증키 확보 후 수행 (MEMORY.md).
 */

export interface BldRgstParams {
  sigunguCd: string; // 5자리
  bjdongCd: string; // 5자리
  platGbCd: '0' | '1'; // 0 대지, 1 산 (블록 2는 지번주소 문자열에서 판별 불가 — 미지원)
  bun: string; // 4자리 zero-pad
  ji: string; // 4자리 zero-pad
}

const pad4 = (n: number) => String(n).padStart(4, '0');

/**
 * @param jibunAddress 예: "서울특별시 용산구 이태원동 34-87 지하1층" / "... 용산동2가 산 1-3"
 * @param regionPrefix 예: "서울특별시 용산구"
 * @param bjdongMap 법정동코드 10자리 → 법정동명 (지역 팩 bjdong.json)
 */
export function parseJibunToParams(
  jibunAddress: string,
  regionPrefix: string,
  bjdongMap: Record<string, string>,
): BldRgstParams | null {
  if (!jibunAddress.startsWith(regionPrefix)) return null;
  const rest = jibunAddress.slice(regionPrefix.length).trim();
  const m = rest.match(/^(\S+)\s+(산\s*)?(\d+)(?:-(\d+))?/);
  if (!m) return null;
  const [, dongName, san, bunRaw, jiRaw] = m;

  const entry = Object.entries(bjdongMap).find(([, name]) => name === dongName);
  if (!entry) return null; // 법정동 맵에 없으면 조회 불가 — 추측 금지, graceful degradation
  const code10 = entry[0];

  return {
    sigunguCd: code10.slice(0, 5),
    bjdongCd: code10.slice(5, 10),
    platGbCd: san ? '1' : '0',
    bun: pad4(Number(bunRaw)),
    ji: pad4(Number(jiRaw ?? 0)),
  };
}
