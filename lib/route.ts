/**
 * 카카오내비 자동차 길찾기: 출발지 → 숙소의 실제 도로 기준 시간·거리.
 * - 결과 표 상위 10곳만 재요 (전국 후보는 직선거리 추정으로 먼저 줄여요).
 * - 출발 시각("YYYY-MM-DD" 또는 "YYYY-MM-DDTHH:MM")이 앞으로라면 그 시각 기준(미래 시각 길찾기), 아니면 지금 교통 기준이에요.
 *   날짜만 주면 그날 오전 10시 출발로 봐요.
 * - 무료 사용량(자동차 길찾기 하루 10,000건) 안에서 쓰도록 KAKAO_ROUTE_DAILY_LIMIT(기본 3,000)으로 막고, 하루 캐시해요.
 * - 비상업 용도에서는 제휴 없이 무료로 쓸 수 있어요. 실제 서비스로 내면 카카오모빌리티 제휴가 필요해요.
 */
import { dailyQuota, dayCache } from './names';

export interface DriveRoute {
  minutes: number;
  km: number;
  departure?: string; // 미래 시각 기준일 때 "11/29(토) 10:00"
}

const cache = dayCache<DriveRoute | null>();
const quota = dailyQuota('KAKAO_ROUTE_DAILY_LIMIT', 3000);
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

export async function driveRoute(from: [number, number], to: [number, number], when?: string): Promise<DriveRoute | null> {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key || !from[0] || !to[0]) return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2}))?$/.exec((when || '').trim());
  const date = m?.[1];
  const hh = m?.[2] ? m[2].padStart(2, '0') : '10';
  const mm = m?.[3] ?? '00';
  const at = date ? new Date(`${date}T${hh}:${mm}:00+09:00`).getTime() : 0;
  const future = !!date && at > Date.now() + 10 * 60_000;
  const ck = `${from.map((x) => x.toFixed(3)).join(',')}>${to.map((x) => x.toFixed(4)).join(',')}@${future ? `${date}T${hh}${mm}` : 'now'}`;
  const hit = cache.get(ck);
  if (hit) return hit.v;
  if (!quota.take()) return null;
  const q = new URLSearchParams({ origin: `${from[1]},${from[0]}`, destination: `${to[1]},${to[0]}`, priority: 'RECOMMEND', summary: 'true' });
  if (future) q.set('departure_time', `${date!.replace(/-/g, '')}${hh}${mm}`);
  try {
    const r = await fetch(`https://apis-navi.kakaomobility.com/v1/${future ? 'future/' : ''}directions?${q}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const s = ((await r.json()) as { routes?: { result_code: number; summary?: { distance: number; duration: number } }[] }).routes?.[0];
    let v: DriveRoute | null = null;
    if (s?.result_code === 0 && s.summary) {
      v = {
        minutes: Math.round(s.summary.duration / 60),
        km: Math.round(s.summary.distance / 100) / 10,
        departure: future ? `${Number(date!.slice(5, 7))}/${Number(date!.slice(8))}(${WEEK[new Date(`${date}T12:00:00+09:00`).getUTCDay()]}) ${hh}:${mm}` : undefined,
      };
    }
    cache.set(ck, v); // 길이 없는 곳(섬 등)도 하루 동안 다시 묻지 않아요
    return v;
  } catch {
    return null;
  }
}
