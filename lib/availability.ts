import { toUrl } from './links';
/**
 * 빈자리 확인.
 * 지금은 캠핑톡 "공공 캠핑장" 달력만 자동으로 확인해요. 로그인 없이 누구나 보는 예약달력이
 * 화면을 그릴 때 쓰는 데이터를 사용자가 요청할 때 한 곳만 조회해요. (공식 API가 아니라 바뀌거나 막힐 수 있어요)
 * 나머지 예약처는 확인했다고 말하지 않고, 예약처 이름과 바로가기만 돌려줘요.
 */
import type { Camp } from './data';

export interface ZoneAvailability {
  name: string;
  left: number; // 해당 기간 내내 비어 있는 사이트 수
  total: number;
  minPrice?: number; // 1박 기준 최저가
  fits: boolean; // 인원 조건에 맞는 사이트가 있는지
}

export type Availability =
  | {
      status: 'ok';
      camp: string;
      platform: '캠핑톡';
      dateLabel: string;
      checkedAt: string;
      zones: ZoneAvailability[];
      totalLeft: number;
      url: string;
    }
  | { status: 'unsupported' | 'error'; camp: string; platform: string; url?: string; reason: string };

const PLATFORMS: [RegExp, string][] = [
  [/camfit/, '캠핏'],
  [/campingtalk/, '캠핑톡'],
  [/thankqcamping/, '땡큐캠핑'],
  [/booking\.naver|naver\.me|map\.naver|place\.naver/, '네이버 예약'],
  [/knps\.or\.kr/, '국립공원 예약'],
  [/foresttrip|huyang/, '숲나들e(자연휴양림)'],
  [/yeyak\.seoul/, '서울시 공공예약'],
  [/ddnayo/, '떠나요'],
  [/camperstory/, '캠퍼스토리'],
  [/interpark/, '인터파크 티켓'],
  [/instagram/, '인스타그램 DM'],
];

export function reservationInfo(camp: Camp) {
  const url = (camp.resveUrl || camp.homepage || '').trim();
  // 예약 주소가 네이버여도 홈페이지가 캠핑톡 공공 캠핑장이면 빈자리를 확인할 수 있어요 (예: 대둔산 수락오토캠핑장)
  const ct = `${camp.resveUrl || ''} ${camp.homepage || ''}`.match(/campingtalk\.me\/pubsec\/camp\/(\d+)/i);
  const platform = PLATFORMS.find(([re]) => re.test(url))?.[1] ?? (url ? '자체 예약 페이지' : camp.resveCl?.includes('전화') ? '전화 예약' : '정보 없음');
  return {
    url: toUrl(camp.resveUrl) || toUrl(camp.homepage),
    platform,
    campingtalkId: ct ? Number(ct[1]) : undefined,
  };
}

export function canCheckLive(camp: Camp) {
  return reservationInfo(camp).campingtalkId !== undefined;
}

/** 받침에 따라 은/는 */
const eunNeun = (w: string) => {
  const c = w.charCodeAt(w.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '은' : '는';
};

const cache = new Map<string, { at: number; value: Availability }>();
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36 StayScout-demo';

const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

export async function checkAvailability(camp: Camp, checkIn: string, nights = 1, people?: number, dateLabel = checkIn): Promise<Availability> {
  const info = reservationInfo(camp);
  if (info.campingtalkId === undefined) {
    return {
      status: 'unsupported',
      camp: camp.facltNm,
      platform: info.platform,
      url: info.url,
      reason: `${info.platform}${eunNeun(info.platform)} 아직 빈자리를 자동으로 확인할 수 없는 예약처예요.`,
    };
  }
  const id = info.campingtalkId;
  const key = `${id}:${checkIn}:${nights}:${people ?? ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;

  const start = new Date(`${checkIn}T00:00:00`);
  const last = new Date(start);
  last.setDate(start.getDate() + Math.max(1, nights) - 1);
  const pageUrl = `https://www.campingtalk.me/pubsec/camp/${id}/calendar`;
  const headers = { 'user-agent': UA, referer: pageUrl, accept: 'application/json' };

  try {
    const [zonesRes, schedRes] = await Promise.all([
      fetch(`https://info.campingtalk.me/api/v1/domain/zone/${id}/list`, { headers, signal: AbortSignal.timeout(8000) }),
      fetch(
        `https://info.campingtalk.me/product/v3/channel/pubsec/camp/${id}/schedule/list?campId=${id}&bookingStartDate=${ymd(start)}&bookingEndDate=${ymd(last)}&siteGroupId=&sortIndex=forCa&channelId=10&pagePerCount=-1`,
        { headers, signal: AbortSignal.timeout(8000) },
      ),
    ]);
    const zonesJson = await zonesRes.json();
    const schedJson = await schedRes.json();
    const zoneName = new Map<number, string>(((zonesJson?.data?.list ?? []) as { zoneId: number; zoneName: string }[]).map((z) => [z.zoneId, z.zoneName]));
    const list = (schedJson?.data?.list ?? []) as {
      siteGroupId: number;
      zoneId: number;
      calendarDate: string;
      saleYn: string;
      stock: number;
      totalStock: number;
      price: number;
      maxQuota: number;
    }[];
    if (schedJson?.status !== 'OK') throw new Error('달력 데이터를 읽지 못했어요.');

    // 사이트 그룹별로 "모든 밤에 남아 있는 수"를 구해요.
    const dates = new Set<string>();
    for (let d = new Date(start); d <= last; d.setDate(d.getDate() + 1)) dates.add(ymd(d));
    const groups = new Map<number, { zoneId: number; left: number; total: number; price: number; maxQuota: number; nights: number }>();
    for (const r of list) {
      if (!dates.has(r.calendarDate)) continue;
      const g = groups.get(r.siteGroupId) ?? { zoneId: r.zoneId, left: Infinity, total: r.totalStock, price: 0, maxQuota: r.maxQuota, nights: 0 };
      g.left = Math.min(g.left, r.saleYn === 'Y' ? Math.max(0, r.stock) : 0);
      g.price += r.price || 0;
      g.nights += 1;
      groups.set(r.siteGroupId, g);
    }
    const zones = new Map<number, ZoneAvailability>();
    for (const g of groups.values()) {
      const left = g.nights === dates.size && Number.isFinite(g.left) ? g.left : 0;
      const z = zones.get(g.zoneId) ?? { name: zoneName.get(g.zoneId) || '기타', left: 0, total: 0, fits: false };
      z.left += left;
      z.total += g.total;
      if (left > 0) {
        const perNight = Math.round(g.price / Math.max(1, g.nights));
        z.minPrice = z.minPrice === undefined ? perNight : Math.min(z.minPrice, perNight);
        if (!people || g.maxQuota >= people) z.fits = true;
      }
      zones.set(g.zoneId, z);
    }
    const zoneList = [...zones.values()].filter((z) => !/체험/.test(z.name)).sort((a, b) => b.left - a.left);
    const value: Availability = {
      status: 'ok',
      camp: camp.facltNm,
      platform: '캠핑톡',
      dateLabel,
      checkedAt: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      zones: zoneList,
      totalLeft: zoneList.reduce((a, z) => a + z.left, 0),
      url: pageUrl,
    };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const why = err.cause?.code || err.cause?.message || err.message;
    console.error('[availability] 캠핑톡 조회 실패', id, why);
    return { status: 'error', camp: camp.facltNm, platform: '캠핑톡', url: pageUrl, reason: `캠핑톡에 연결하지 못해 빈자리를 확인하지 못했어요. (${why})` };
  }
}
