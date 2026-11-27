/**
 * 네이버 지역 검색 (NAVER API HUB): 구글에서 홈페이지를 못 찾은 펜션에 네이버에 등록된 링크를 붙여요.
 * - 호스트 naverapihub.apigw.ntruss.com, 헤더 X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY (.env의 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET)
 * - 하루 호출 수는 NAVER_DAILY_LIMIT(기본 50)로 막고(한국 날짜 기준), 결과는 서버 메모리에 하루만 둬요.
 * - 이름이 비슷하고 같은 시·군에 있는 곳만 같은 곳으로 봐요.
 */
import type { Camp } from './data';
import { dailyQuota, dayCache, sameName } from './names';

export interface NaverPlace {
  name: string;
  link?: string;
  linkKind?: '홈페이지' | '블로그' | '인스타그램' | '예약';
  category?: string;
  phone?: string;
}

const cache = dayCache<NaverPlace | null>();
const quota = dailyQuota('NAVER_DAILY_LIMIT', 50);

function kindOf(url: string): NaverPlace['linkKind'] {
  if (/instagram\.com/.test(url)) return '인스타그램';
  if (/blog\.naver\.com|tistory\.com|blog\./.test(url)) return '블로그';
  if (/booking\.naver\.com|ddnayo|yanolja|goodchoice|yeogi|staymg/.test(url)) return '예약';
  return '홈페이지';
}

export async function naverPlace(c: Camp): Promise<NaverPlace | null> {
  const id = process.env.NAVER_CLIENT_ID, secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return null;
  const hit = cache.get(c.contentId);
  if (hit) return hit.v;
  if (!quota.take()) return null;
  try {
    const area = (c.sigunguNm || '').replace(/(시|군|구)$/, '');
    const u = `https://naverapihub.apigw.ntruss.com/search/v1/local?display=5&query=${encodeURIComponent(`${area} ${c.facltNm}`)}`;
    const r = await fetch(u, { headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { items?: { title: string; link?: string; category?: string; telephone?: string; address?: string; roadAddress?: string }[] };
    const found = (j.items ?? []).find((it) => {
      const sameArea = !!c.sigunguNm && `${it.roadAddress} ${it.address}`.includes(c.sigunguNm);
      return sameArea && sameName(c.facltNm, it.title);
    });
    const v: NaverPlace | null = found
      ? {
          name: found.title.replace(/<[^>]+>/g, ''),
          link: found.link || undefined,
          linkKind: found.link ? kindOf(found.link) : undefined,
          category: found.category,
          phone: found.telephone || undefined,
        }
      : null;
    cache.set(c.contentId, v);
    return v;
  } catch {
    return null;
  }
}
