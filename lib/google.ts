/**
 * 구글 Places API (New): 펜션의 공식 홈페이지·평점·전화를 찾아요.
 * - 검색 결과 상위 곳만 그때그때 찾아요. 구글 약관상 장소 정보는 오래 저장할 수 없어서
 *   서버 메모리에 하루만 두고(같은 곳을 다시 볼 때 호출을 아끼려고), 파일로는 저장하지 않아요.
 * - 무료 사용량(월 1,000건) 안에서 쓰도록 하루 호출 수를 GOOGLE_DAILY_LIMIT(기본 30)로 막아요. 한국 날짜 기준으로 세요.
 * - 약 300m 안이거나, 1.5km 안이면서 이름이 같은(한쪽이 다른 쪽에 들어 있는) 장소만 같은 곳으로 봐요.
 */
import type { Camp } from './data';
import { dailyQuota, dayCache, sameName } from './names';

export interface GooglePlace {
  name: string;
  website?: string;
  rating?: number;
  reviews?: number;
  phone?: string;
  mapsUrl?: string;
}

const cache = dayCache<GooglePlace | null>();
const quota = dailyQuota('GOOGLE_DAILY_LIMIT', 30);

const DEG = Math.PI / 180;
function dist(a: [number, number], b: [number, number]) {
  const dLat = (b[0] - a[0]) * DEG, dLon = (b[1] - a[1]) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * DEG) * Math.cos(b[0] * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export async function googlePlace(c: Camp): Promise<GooglePlace | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !Number(c.mapY)) return null;
  const hit = cache.get(c.contentId);
  if (hit) return hit.v;
  if (!quota.take()) return null; // 오늘 한도: 저장하지 않고 다음에 다시
  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.displayName,places.websiteUri,places.rating,places.userRatingCount,places.nationalPhoneNumber,places.location,places.googleMapsUri',
      },
      body: JSON.stringify({
        textQuery: `${c.facltNm} ${c.sigunguNm}`,
        languageCode: 'ko',
        regionCode: 'KR',
        pageSize: 3,
        locationBias: { circle: { center: { latitude: Number(c.mapY), longitude: Number(c.mapX) }, radius: 2000 } },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null; // 오류는 저장하지 않아요
    const j = (await r.json()) as { places?: { displayName?: { text: string }; websiteUri?: string; rating?: number; userRatingCount?: number; nationalPhoneNumber?: string; location?: { latitude: number; longitude: number }; googleMapsUri?: string }[] };
    const here: [number, number] = [Number(c.mapY), Number(c.mapX)];
    // 같은 위치 후보 중 이름이 비슷하고 홈페이지·평점이 있는 곳을 먼저 골라요
    const cands = (j.places ?? [])
      .filter((p) => p.location)
      .map((p) => {
        const d = dist(here, [p.location!.latitude, p.location!.longitude]);
        const similar = sameName(c.facltNm, p.displayName?.text || '');
        return { p, ok: d < 300 || (d < 1500 && similar), score: (similar ? 4 : 0) + (p.websiteUri ? 2 : 0) + (p.userRatingCount ? 1 : 0) - d / 1000 };
      })
      .filter((x) => x.ok)
      .sort((x, y) => y.score - x.score);
    const best = cands[0]?.p;
    const v: GooglePlace | null = best
      ? {
          name: best.displayName?.text || '',
          website: best.websiteUri,
          rating: best.rating,
          reviews: best.userRatingCount,
          phone: best.nationalPhoneNumber,
          mapsUrl: best.googleMapsUri?.replace(/&g_mp=.*$/, ''),
        }
      : null;
    cache.set(c.contentId, v);
    return v;
  } catch {
    return null;
  }
}
