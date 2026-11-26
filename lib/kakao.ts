/**
 * 고캠핑에 없는 캠핑장 보완: 카카오 장소 검색(공식 API)으로 같은 지역의 캠핑장을 찾고,
 * 고캠핑 목록과 이름·위치가 겹치는 곳은 빼요. 카카오에는 시설 정보가 없어서 조건은 모두 "확인 안 됨"이에요.
 */
import { estimateMinutes, loadCamps, type Camp } from './data';
import type { AgentState, ExtraPlace } from './types';

const cache = new Map<string, { at: number; docs: KakaoDoc[] }>();

interface KakaoDoc {
  id: string;
  place_name: string;
  category_name: string;
  address_name: string;
  road_address_name: string;
  phone: string;
  place_url: string;
  x: string;
  y: string;
}

const norm = (s: string) =>
  s
    .replace(/\s|\(.*?\)|[&·,.\-_'"]/g, '')
    .replace(/(오토캠핑장|캠핑장|야영장|글램핑장|글램핑|카라반|캠핑)$/g, '')
    .toLowerCase();

/** 두 이름이 3글자 이상 같은 부분을 공유하는지 */
function shares(a: string, b: string) {
  for (let i = 0; i + 3 <= a.length; i++) if (b.includes(a.slice(i, i + 3))) return true;
  return false;
}

function distanceM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function keyword(query: string, key: string): Promise<KakaoDoc[]> {
  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.docs;
  const docs: KakaoDoc[] = [];
  for (let page = 1; page <= 3; page++) {
    const r = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?size=15&page=${page}&query=${encodeURIComponent(query)}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) break;
    const d = await r.json();
    docs.push(...((d.documents ?? []) as KakaoDoc[]));
    if (d.meta?.is_end) break;
  }
  cache.set(query, { at: Date.now(), docs });
  return docs;
}

/** 지역 조건이 있을 때만 동작해요 (카카오 반경 검색은 최대 20km라 "2시간 이내" 같은 넓은 범위엔 맞지 않아요). */
export async function kakaoExtras(state: AgentState, origin?: [number, number]): Promise<ExtraPlace[]> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key || !state.regions.length) return [];
  const { camps } = loadCamps();
  const regions = state.regions.slice(0, 2).map((r) => r.replace(/(특별자치도|특별자치시|특별시|광역시|시|군|구)$/, ''));
  const wantGlamping = state.conds.some((c) => c.key === 'induty:글램핑');

  const docs: KakaoDoc[] = [];
  try {
    for (const r of regions) {
      docs.push(...(await keyword(`${r} 캠핑장`, key)));
      if (wantGlamping) docs.push(...(await keyword(`${r} 글램핑`, key)));
    }
  } catch {
    return [];
  }

  const gcNames = new Map<string, Camp>();
  for (const c of camps) gcNames.set(norm(c.facltNm), c);
  const seen = new Set<string>();
  const out: ExtraPlace[] = [];
  for (const d of docs) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    if (!/캠핑|야영|글램핑|카라반/.test(d.category_name)) continue;
    const addr = d.road_address_name || d.address_name;
    if (!regions.some((r) => addr.includes(r))) continue;
    const lat = Number(d.y);
    const lng = Number(d.x);
    // 고캠핑에 이미 있는 곳이면 빼요: 이름이 같거나, 300m 안에 비슷한 이름이 있으면
    const n = norm(d.place_name);
    if (gcNames.has(n)) continue;
    const near = camps.some((c) => {
      const cl = Number(c.mapY);
      const cg = Number(c.mapX);
      if (!cl || !cg) return false;
      const dist = distanceM(lat, lng, cl, cg);
      if (dist > 1000) return false;
      const m = norm(c.facltNm);
      return dist < 100 || m.includes(n) || n.includes(m) || shares(n, m);
    });
    if (near) continue;
    const minutes = origin ? estimateMinutes(origin, { mapX: d.x, mapY: d.y } as Camp) : undefined;
    if (out.some((o) => shares(norm(o.name), n) && o.address.split(' ').slice(0, 3).join(' ') === addr.split(' ').slice(0, 3).join(' '))) continue;
    out.push({
      id: d.id,
      name: d.place_name,
      address: addr,
      phone: d.phone || undefined,
      url: d.place_url,
      category: d.category_name.split('>').pop()?.trim() || '캠핑장',
      minutes,
    });
  }
  return out.slice(0, 15);
}

/**
 * 고캠핑 정보가 오래되면 이름·예약처가 바뀐 경우가 있어요(예: 장수자연관광농원 → 용인단풍숲캠핑장).
 * 같은 좌표 근처의 카카오 장소를 찾아 지금 이름과 전화번호를 알려 줘요. 상위 몇 곳만, 하루 캐시.
 */
export interface PlaceNow {
  name: string;
  phone?: string;
  url: string;
  renamed: boolean;
}
const placeCache = new Map<string, { at: number; v: PlaceNow | null }>();

async function nearby(query: string, lng: string, lat: string, key: string): Promise<KakaoDoc[]> {
  const r = await fetch(
    `https://dapi.kakao.com/v2/local/search/keyword.json?size=15&sort=distance&radius=300&x=${lng}&y=${lat}&query=${encodeURIComponent(query)}`,
    { headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(5000) }
  );
  if (!r.ok) return [];
  return ((await r.json()).documents ?? []) as KakaoDoc[];
}

export async function placeNow(c: Camp): Promise<PlaceNow | null> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key || !Number(c.mapX) || !Number(c.mapY)) return null;
  const hit = placeCache.get(c.contentId);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.v;
  let v: PlaceNow | null = null;
  try {
    const lat = Number(c.mapY);
    const lng = Number(c.mapX);
    const got = await Promise.all([c.facltNm, '캠핑장', '캠핑'].map((q) => nearby(q, c.mapX, c.mapY, key)));
    const seen = new Set<string>();
    const docs = got
      .flat()
      .filter((d) => !seen.has(d.id) && seen.add(d.id))
      .map((d) => ({ d, dist: distanceM(lat, lng, Number(d.y), Number(d.x)) }))
      .sort((a, b) => a.dist - b.dist);
    const n = norm(c.facltNm);
    const same = (name: string) => {
      const m = norm(name);
      return m === n || m.includes(n) || n.includes(m) || shares(m, n);
    };
    const isCamp = (d: KakaoDoc) => /캠핑|야영|글램핑|카라반/.test(d.category_name);
    // 캠핑장 이름만 남겨요: "이레캠핑장 샤워장" → "이레캠핑장"
    const baseName = (name: string) => name.match(/^\S*(캠핑장|캠핑|캠프|글램핑|야영장|오토캠핑장)\S*/)?.[0] ?? name;
    const old = docs.find(({ d, dist }) => dist < 1000 && isCamp(d) && same(d.place_name));
    // 좌표 60m 안에 다른 이름의 캠핑장(또는 그 캠핑장의 샤워장·운동장 같은 부속시설)이 있으면 이름이 바뀐 걸로 봐요.
    const other = docs.find(
      ({ d, dist }) =>
        dist <= 60 && !same(d.place_name) && (isCamp(d) || /캠핑|캠프|글램핑/.test(d.place_name)) && (!old || dist <= old.dist + 60)
    );
    if (other) {
      const main = docs.find(({ d }) => isCamp(d) && baseName(d.place_name) === baseName(other.d.place_name));
      const src = main ?? other;
      v = {
        name: baseName(src.d.place_name),
        phone: src.d.phone || old?.d.phone || undefined,
        url: src.d.place_url,
        renamed: true,
      };
    } else if (old) {
      v = { name: old.d.place_name, phone: old.d.phone || undefined, url: old.d.place_url, renamed: false };
    }
  } catch {
    return null; // 일시 오류는 캐시하지 않아요
  }
  placeCache.set(c.contentId, { at: Date.now(), v });
  return v;
}
