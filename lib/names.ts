/**
 * 숙소 이름 비교와 외부 API 하루 한도 — 구글·네이버·이름 검색이 같이 써요.
 */

const PUNCT = /[\s&·.,()[\]'"!?~\-_/]/g;
const SUFFIX = /(오토캠핑장|캠핑장|캠핑파크|캠핑|야영장|글램핑장|글램핑|카라반|캠프|펜션|풀빌라|민박|스테이)$/;

/** 비교용 이름: 태그·(주)·띄어쓰기·기호를 빼요 */
export function normName(s: string) {
  return (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\(주\)|주식회사/g, '')
    .toLowerCase()
    .replace(PUNCT, '');
}

/** 이름 핵심: normName에서 끝의 "캠핑장·펜션" 같은 유형 이름까지 떼요 ("다올숲 캠핑장" → 다올숲) */
export function nameCore(s: string) {
  return normName(s).replace(SUFFIX, '');
}

/**
 * 같은 숙소 이름인지: 한쪽 이름이 다른 쪽에 통째로 들어 있을 때만 같다고 봐요.
 * 앞 글자만 같은 경우("가평하늘" / "가평별빛")는 지역명이 겹친 것일 수 있어서 인정하지 않아요.
 */
export function sameName(a: string, b: string) {
  const x = nameCore(a), y = nameCore(b);
  if (x.length < 2 || y.length < 2) return false;
  return x.includes(y) || y.includes(x);
}

/** 한국 날짜(YYYY-MM-DD) */
export function kstDay(now = Date.now()) {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 외부 API 하루 호출 한도. 한국 날짜가 바뀌면 다시 세요. */
export function dailyQuota(envKey: string, fallback: number) {
  let day = '';
  let used = 0;
  return {
    /** 한 번 쓸 수 있으면 세고 true, 오늘 한도를 다 썼으면 false */
    take() {
      const today = kstDay();
      if (today !== day) {
        day = today;
        used = 0;
      }
      if (used >= Number(process.env[envKey] || fallback)) return false;
      used++;
      return true;
    },
  };
}

/** 하루 동안 기억하는 메모리 캐시 (실패는 넣지 않아요) */
export function dayCache<T>() {
  const mem = new Map<string, { at: number; v: T }>();
  const TTL = 24 * 3600_000;
  return {
    get(k: string): { v: T } | undefined {
      const hit = mem.get(k);
      return hit && Date.now() - hit.at < TTL ? { v: hit.v } : undefined;
    },
    set(k: string, v: T) {
      mem.set(k, { at: Date.now(), v });
    },
  };
}
