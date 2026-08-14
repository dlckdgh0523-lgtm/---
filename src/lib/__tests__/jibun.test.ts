/** 지번주소 → 건축HUB 파라미터 파싱 검증 (번·지 4자리 패딩, 산 구분, 추측 금지 폴백) */
import { parseJibunToParams } from '@/lib/jibun';

const PREFIX = '서울특별시 용산구';
const BJDONG = {
  '1117013100': '이태원동',
  '1117012400': '용산동2가',
};

describe('parseJibunToParams', () => {
  it('일반 지번: 번-지 분리 + 4자리 zero-pad', () => {
    const p = parseJibunToParams('서울특별시 용산구 이태원동 34-87 지하1층', PREFIX, BJDONG);
    expect(p).toEqual({ sigunguCd: '11170', bjdongCd: '13100', platGbCd: '0', bun: '0034', ji: '0087' });
  });

  it('지 없는 지번: ji = 0000', () => {
    const p = parseJibunToParams('서울특별시 용산구 이태원동 34', PREFIX, BJDONG);
    expect(p?.bun).toBe('0034');
    expect(p?.ji).toBe('0000');
  });

  it('산 지번: platGbCd = 1', () => {
    const p = parseJibunToParams('서울특별시 용산구 용산동2가 산 1-3', PREFIX, BJDONG);
    expect(p?.platGbCd).toBe('1');
    expect(p?.bun).toBe('0001');
    expect(p?.ji).toBe('0003');
  });

  it('법정동 맵에 없는 동: null (코드를 추측하지 않는다)', () => {
    expect(parseJibunToParams('서울특별시 용산구 없는동 1-2', PREFIX, BJDONG)).toBeNull();
  });

  it('다른 지역 주소·번지 없는 주소: null', () => {
    expect(parseJibunToParams('서울특별시 마포구 서교동 1-2', PREFIX, BJDONG)).toBeNull();
    expect(parseJibunToParams('서울특별시 용산구 이태원동', PREFIX, BJDONG)).toBeNull();
  });
});
