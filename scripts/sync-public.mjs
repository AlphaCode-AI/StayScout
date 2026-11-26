// 공공데이터 2종을 받아 data/에 저장해요. (같은 공공데이터포털 인증키)
// 1) 행정안전부 일반야영장업 인허가 → data/license.json : 정식 등록 여부, 영업/폐업 상태
// 2) 전국 자연휴양림 표준데이터 → data/forest.json : 주요시설, 입장료, 수용인원
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const key = env.GOCAMPING_SERVICE_KEY;

async function pages(base, params, pick) {
  let all = [];
  for (let page = 1; page < 200; page++) {
    const u = new URL(base);
    u.search = new URLSearchParams({ serviceKey: key, pageNo: String(page), numOfRows: '500', ...params }).toString();
    // 응답이 느려서 쪽마다 캐시해 두고, 중간에 끊기면 이어서 받아요.
    const cache = join(root, 'data', '.cache', `${base.split('/').pop()}-${page}.json`);
    let d;
    if (existsSync(cache)) d = JSON.parse(readFileSync(cache, 'utf8'));
    if (!(d?.response?.body ?? d?.body)) for (let t = 1; ; t++) {
      try {
        d = await (await fetch(u, { signal: AbortSignal.timeout(60000) })).json();
        if (!(d?.response?.body ?? d?.body)) throw Object.assign(new Error('게이트웨이 오류'), { name: 'GatewayError' });
        mkdirSync(dirname(cache), { recursive: true });
        writeFileSync(cache, JSON.stringify(d));
        break;
      } catch (e) {
        if (t >= 6) throw e;
        console.log(`  ${page}쪽 재시도 ${t} (${e.name})`);
        await new Promise((r) => setTimeout(r, 2000 * t));
      }
    }
    const { items, total } = pick(d);
    all = all.concat(items);
    console.log(`  ${base.split('/').pop()} ${page}쪽: ${all.length}/${total}`);
    if (!items.length || all.length >= total) break;
  }
  return all;
}

const lic = await pages('https://apis.data.go.kr/1741000/general_campgrounds/info', { returnType: 'json' }, (d) => {
  const b = d?.response?.body;
  const it = b?.items?.item ?? [];
  return { items: Array.isArray(it) ? it : [it], total: Number(b?.totalCount ?? 0) };
});
const license = lic.map((x) => ({
  name: x.BPLC_NM || '',
  road: x.ROAD_NM_ADDR || '',
  lot: x.LOTNO_ADDR || '',
  status: x.SALS_STTS_NM || '',
  detail: x.DTL_SALS_STTS_NM || '',
  permit: x.LCPMT_YMD || '',
  closed: x.CLSBIZ_YMD || '',
  scale: x.FCLT_SCL || '',
}));
writeFileSync(join(root, 'data', 'license.json'), JSON.stringify({ syncedAt: new Date().toISOString(), source: '행정안전부 일반야영장업 인허가', count: license.length, items: license }));

const fr = await pages('http://api.data.go.kr/openapi/tn_pubr_public_rcrfrst_api', { type: 'json' }, (d) => {
  const b = d?.response?.body ?? d?.body;
  const it = b?.items?.item ?? b?.items ?? [];
  return { items: Array.isArray(it) ? it : [it], total: Number(b?.totalCount ?? 0) };
});
const forest = fr.map((x) => ({
  name: x.rcrfrstNm,
  sido: x.ctprvnNm,
  type: x.rcrfrstType,
  capacity: x.aceptncCo,
  fee: x.admfee,
  stay: x.stayngPosblYn,
  facilities: x.mainFcltyNm,
  address: x.rdnmadr,
  tel: x.telephoneNumber,
  homepage: x.homepageUrl,
  lat: Number(x.latitude),
  lng: Number(x.longitude),
  date: x.referenceDate,
}));
writeFileSync(join(root, 'data', 'forest.json'), JSON.stringify({ syncedAt: new Date().toISOString(), source: '전국 자연휴양림 표준데이터', count: forest.length, items: forest }));
console.log(`✅ 야영장업 인허가 ${license.length}건, 자연휴양림 ${forest.length}곳 저장`);
