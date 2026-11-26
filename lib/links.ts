/**
 * 고캠핑의 홈페이지·예약 주소는 사람이 직접 입력한 값이라 형식이 제각각이에요.
 * - "www.태봉.com"처럼 http가 빠지면 화면에서 상대 주소가 돼 열리지 않아요 → 고쳐서 써요.
 * - "네이버"처럼 주소가 아닌 값은 링크로 쓰지 않아요.
 * - 도메인이 없어졌거나 서버가 응답하지 않는 링크는 표시해요(하루 캐시).
 */
export function toUrl(raw?: string): string | undefined {
  const s = (raw || '').trim();
  if (!s) return undefined;
  const withScheme = /^https?:\/\//i.test(s) ? s : /^[\w가-힣-]+(\.[\w가-힣-]+)+(\/|$|\?)/.test(s) ? `http://${s}` : '';
  if (!withScheme) return undefined;
  try {
    return new URL(withScheme).toString();
  } catch {
    return undefined;
  }
}

const cache = new Map<string, { at: number; ok: boolean | undefined }>();

/** 이 오류일 때만 "안 열림"으로 봐요: 도메인이 없거나, 서버가 연결을 거부함 */
const DEAD = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ERR_INVALID_URL']);

/**
 * 응답이 오기만 하면(403 포함) 열린다고 봐요.
 * 시간 초과·인증서 문제처럼 우리 쪽 사정일 수 있는 오류는 "모름"(undefined)으로 두고 표시하지 않아요.
 * (캠핏처럼 봇 차단이 있는 사이트는 서버에서 확인하면 실패해도 브라우저에서는 열려요)
 */
export async function linkAlive(url?: string): Promise<boolean | undefined> {
  if (!url) return undefined;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.ok;
  let ok: boolean | undefined;
  for (let t = 0; t < 2; t++) {
    try {
      await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(6000),
        headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' },
      });
      ok = true;
      break;
    } catch (e) {
      const code = (e as { cause?: { code?: string } })?.cause?.code ?? '';
      if (DEAD.has(code)) {
        ok = false;
        break;
      }
      ok = undefined; // 모름: 다시 한 번 시도하고, 그래도 안 되면 표시하지 않아요
    }
  }
  cache.set(url, { at: Date.now(), ok });
  return ok;
}

/** 한국 전화번호 형식이 맞는지 (고캠핑에 "010-2011-314"처럼 한 자리가 빠진 번호가 있어요) */
export function phoneLooksValid(tel?: string) {
  const d = (tel || '').replace(/\D/g, '');
  if (!d) return true;
  if (/^010/.test(d)) return d.length === 11;
  if (/^01[16-9]/.test(d)) return d.length === 10 || d.length === 11;
  if (/^0(50|70)\d/.test(d)) return d.length >= 11 && d.length <= 12;
  if (/^1[5-9]\d{2}/.test(d)) return d.length === 8;
  return d.length >= 9 && d.length <= 11;
}

export const naverSearch = (q: string) => `https://search.naver.com/search.naver?query=${encodeURIComponent(q)}`;
