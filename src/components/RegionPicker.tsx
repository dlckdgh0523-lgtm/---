'use client';

/**
 * 지도에서 활동 지역을 핀으로 짚어 고르는 선택기 (설정 A 섹션 보조).
 * - 카카오맵 클릭 → services 라이브러리(coord2RegionCode, JS 키로 동작 — REST 키 불필요)로
 *   행정구역 역지오코딩 → 시군구코드 확정.
 * - 데이터 팩(레지스트리)이 있는 지역이면 즉시 선택 확정, 없으면 "데이터 준비 안 됨"만 표시하고
 *   선택은 막지 않는다(빈 리스트가 뜨는 것은 기존 graceful 동작).
 * - 키(NEXT_PUBLIC_KAKAO_MAP_KEY)가 없으면 이 컴포넌트는 렌더하지 않는다(드롭다운으로 대체).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { findRegion } from '@/data/regions';
import type { RegionRegistry } from '@/lib/region-registry';

const KAKAO_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

declare global {
  interface Window {
    kakao: any;
  }
}

export default function RegionPicker({
  registry,
  onPick,
}: {
  registry: RegionRegistry;
  onPick: (sigunguCode: string) => void;
}) {
  const [sdkReady, setSdkReady] = useState(false);
  const [lastHit, setLastHit] = useState<{ code: string; label: string; hasPack: boolean } | null>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const geocoderRef = useRef<any>(null);

  useEffect(() => {
    if (!sdkReady || !mapEl.current || mapRef.current) return;
    const kakao = window.kakao;
    // 서울 시청 중심으로 시작 (지역 미선택 상태 기본값 — 지어낸 좌표 아님)
    const map = new kakao.maps.Map(mapEl.current, { center: new kakao.maps.LatLng(37.5665, 126.978), level: 9 });
    const geocoder = new kakao.maps.services.Geocoder();
    geocoderRef.current = geocoder;

    kakao.maps.event.addListener(map, 'click', (e: any) => {
      const latlng = e.latLng;
      // 클릭 지점에 핀
      if (markerRef.current) markerRef.current.setMap(null);
      markerRef.current = new kakao.maps.Marker({ position: latlng, map });
      geocoder.coord2RegionCode(latlng.getLng(), latlng.getLat(), (result: any[], status: any) => {
        if (status !== kakao.maps.services.Status.OK) return;
        const b = result.find((r) => r.region_type === 'B') ?? result[0]; // 법정동 기준
        if (!b) return;
        const sigunguCode = String(b.code).slice(0, 5);
        const region = findRegion(sigunguCode);
        const hasPack = registry.regions.some((x) => x.code === sigunguCode);
        setLastHit({
          code: sigunguCode,
          label: region ? `${region.sido.name} ${region.sigungu.name}` : `${b.region_1depth_name} ${b.region_2depth_name}`,
          hasPack,
        });
        onPick(sigunguCode);
      });
    });

    mapRef.current = map;
  }, [sdkReady, registry, onPick]);

  if (!KAKAO_KEY) return null;

  return (
    <div className="space-y-2">
      <Script
        src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&autoload=false&libraries=services`}
        strategy="afterInteractive"
        onLoad={() => window.kakao.maps.load(() => setSdkReady(true))}
      />
      <p className="text-xs text-slate-500">지도를 눌러 활동 지역을 짚으세요. 위 드롭다운과 연동됩니다.</p>
      <div ref={mapEl} className="h-56 w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
        {!sdkReady && <div className="flex h-full items-center justify-center text-sm text-slate-400">지도 불러오는 중…</div>}
      </div>
      {lastHit && (
        <p className="text-sm">
          <b>{lastHit.label}</b> 선택됨 —{' '}
          {lastHit.hasPack ? (
            <span className="text-emerald-700">접점 데이터 준비됨</span>
          ) : (
            <span className="text-amber-700">이 지역은 아직 데이터 팩이 없습니다 (접점 리스트가 비어 있게 됩니다)</span>
          )}
        </p>
      )}
    </div>
  );
}
