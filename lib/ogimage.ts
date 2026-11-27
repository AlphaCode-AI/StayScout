/**
 * 홈페이지 대표 이미지(og:image): 링크 미리보기에 쓰라고 사이트가 직접 지정해 둔 사진 한 장이에요.
 * 공공데이터·구글에 사진이 없는 숙소의 상세 보기에서만, 한 곳에 한 장 가져와요. 하루 캐시.
 */
import { dayCache } from './names';

const cache = dayCache<string | null>();

// 숙소 사진이 아닌 대표 이미지 (지도 기본 그림, 이미지 없음, 로고·아이콘)
const GENERIC = /og-map|noimage|no_image|no-image|blank\.|favicon|apple-touch-icon|\/logo|_logo|logo\.|placeholder|default_og/i;

function pick(html: string) {
  for (const prop of ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image']) {
    const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
    for (const m of metas) {
      const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(m)?.[1]?.toLowerCase();
      const content = /content\s*=\s*["']([^"']*)["']/i.exec(m)?.[1]?.trim();
      if (key === prop && content) return content.replace(/&amp;/g, '&');
    }
  }
  return null;
}

export async function ogImage(pageUrl?: string): Promise<string | null> {
  if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) return null;
  // 지도·검색 페이지는 숙소 사진이 아니라 기본 그림이에요
  if (/map\.naver\.com|naver\.me|map\.kakao|place\.map|search\.naver\.com|google\.[a-z.]+\/maps/i.test(pageUrl)) return null;
  const hit = cache.get(pageUrl);
  if (hit) return hit.v;
  let img: string | null = null;
  try {
    const r = await fetch(pageUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', accept: 'text/html' },
    });
    if (r.ok && /html/i.test(r.headers.get('content-type') || 'text/html')) {
      // 대표 이미지는 <head>에 있어서 앞부분만 읽어요
      const html = (await r.text()).slice(0, 300_000);
      const raw = pick(html);
      if (raw) {
        const abs = new URL(raw, r.url || pageUrl).toString();
        if (/^https?:\/\//.test(abs) && !GENERIC.test(abs)) img = abs;
      }
    }
  } catch {
    // 열리지 않거나 시간이 지나면 사진 없이 둬요
  }
  cache.set(pageUrl, img);
  return img;
}
