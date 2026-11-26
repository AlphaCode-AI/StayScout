import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface KakaoGeoDoc {
  x: string;
  y: string;
  address_name?: string;
  road_address_name?: string;
  place_name?: string;
  address?: { region_2depth_name?: string; region_3depth_name?: string; region_3depth_h_name?: string };
  road_address?: { region_2depth_name?: string; region_3depth_name?: string };
}

/** 주소·장소 이름 → 좌표 (카카오 로컬 API). GET /api/geocode?q=주소  또는 ?lat=..&lng=.. (좌표 → 동네 이름) */
export async function GET(req: Request) {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return NextResponse.json({ error: '.env에 KAKAO_REST_API_KEY가 없어요.' }, { status: 503 });
  const url = new URL(req.url);
  const headers = { Authorization: `KakaoAK ${key}` };

  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');
  if (lat && lng) {
    const r = await fetch(`https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${lng}&y=${lat}`, { headers });
    const d = await r.json();
    const region = d?.documents?.find((x: { region_type: string }) => x.region_type === 'H') ?? d?.documents?.[0];
    return NextResponse.json({ label: region ? `${region.region_2depth_name} ${region.region_3depth_name}`.trim() : '현재 위치' });
  }

  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return NextResponse.json({ error: '주소를 입력해 주세요.' }, { status: 400 });

  const tryFetch = async (path: string, size: number, page = 1) => {
    const r = await fetch(`https://dapi.kakao.com${path}?query=${encodeURIComponent(q)}&size=${size}&page=${page}`, { headers });
    if (!r.ok) {
      const body = await r.text();
      if (body.includes('OPEN_MAP_AND_LOCAL')) {
        throw new Error('카카오 디벨로퍼스 > 내 애플리케이션 > 카카오맵에서 "사용 설정"을 켜 주세요. 켠 뒤 1~2분 후에 다시 검색하면 돼요.');
      }
      if (r.status === 401) throw new Error('카카오 REST API 키가 올바르지 않아요. .env의 KAKAO_REST_API_KEY를 확인해 주세요.');
      throw new Error(`주소 검색에 실패했어요. (카카오 API ${r.status})`);
    }
    return ((await r.json())?.documents ?? []) as KakaoGeoDoc[];
  };
  /**
   * 자세한 주소(번지)는 필요 없어요: 이동 시간 추정에는 동네 정도면 충분해서,
   * 동 이름까지만 남기고 좌표도 소수 둘째 자리(약 1km)로 뭉개서 돌려줘요.
   */
  const dongOnly = (a: string) => {
    const t = a.trim().split(/\s+/);
    while (t.length > 2 && /\d|^산$|^지하$/.test(t[t.length - 1])) t.pop();
    return t.join(' ');
  };
  const round = (v: string) => Math.round(Number(v) * 100) / 100;
  const toPlace = (doc: KakaoGeoDoc) => {
    const label = doc.address?.region_2depth_name
      ? `${doc.address.region_2depth_name} ${doc.address.region_3depth_h_name || doc.address.region_3depth_name || ''}`.trim()
      : doc.road_address?.region_2depth_name
        ? `${doc.road_address.region_2depth_name} ${doc.road_address.region_3depth_name || ''}`.trim()
        : dongOnly(doc.address_name || q);
    return { lat: round(doc.y), lng: round(doc.x), label, address: dongOnly(doc.address_name || doc.road_address_name || q) };
  };
  try {
    // "중앙동"처럼 전국에 여러 곳이 있으면 후보를 모두 돌려줘서 고르게 해요
    let docs = await tryFetch('/v2/local/search/address.json', 30);
    // 한 번에 30곳까지라, 꽉 차면 두 쪽 더 받아요 (전국 "중앙동"은 30곳이 넘어요)
    for (let page = 2; page <= 3 && docs.length === (page - 1) * 30; page++) docs = docs.concat(await tryFetch('/v2/local/search/address.json', 30, page));
    if (!docs.length) docs = await tryFetch('/v2/local/search/keyword.json', 15);
    const seen = new Set<string>();
    const results = docs.map(toPlace).filter((x) => !seen.has(x.address) && seen.add(x.address));
    if (!results.length) return NextResponse.json({ error: '주소를 찾지 못했어요. 도로명이나 동 이름으로 다시 입력해 주세요.' }, { status: 404 });
    return NextResponse.json({ ...results[0], results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
