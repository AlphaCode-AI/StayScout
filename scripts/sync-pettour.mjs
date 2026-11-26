// 한국관광공사 반려동물 동반여행 서비스에서 캠핑장의 반려동물 동반 조건을 받아,
// 고캠핑 캠핑장과 이름·위치로 연결해 data/pet.json에 저장해요. (같은 공공데이터포털 인증키 사용)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const key = env.GOCAMPING_SERVICE_KEY;
const base = 'https://apis.data.go.kr/B551011/KorPetTourService2/';
const call = async (op, params) => {
  const u = new URL(base + op);
  u.search = new URLSearchParams({ serviceKey: key, MobileOS: 'ETC', MobileApp: 'StayScout', _type: 'json', ...params }).toString();
  const d = await (await fetch(u)).json();
  const it = d?.response?.body?.items?.item ?? [];
  return { total: Number(d?.response?.body?.totalCount ?? 0), items: Array.isArray(it) ? it : [it] };
};

let all = [];
for (let page = 1; page < 30; page++) {
  const { total, items } = await call('areaBasedList2', { numOfRows: '1000', pageNo: String(page) });
  all = all.concat(items);
  if (!items.length || all.length >= total) break;
}
const camps = JSON.parse(readFileSync(join(root, 'data', 'camps.json'), 'utf8')).camps;
const norm = (s) => s.replace(/\s|\(.*?\)|[&·,.\-_]/g, '').replace(/(오토캠핑장|캠핑장|야영장|글램핑장|글램핑|카라반|캠핑)$/, '');
const byName = new Map(camps.map((c) => [norm(c.facltNm), c]));
// 흔한 단어(글램핑, 캠핑, 오토 등)를 빼고 고유한 이름 부분만 비교해요
const core = (s) => norm(s).replace(/글램핑|캠핑|야영장|야영|오토|자연휴양림|휴양림|캠프|리조트|펜션|in/gi, '');
const shares = (a, b) => { for (let i = 0; i + 3 <= a.length; i++) if (b.includes(a.slice(i, i + 3))) return true; return false; };
const targets = all.filter((x) => /캠핑|글램핑|카라반|야영/.test(x.title));

const out = {};
for (const x of targets) {
  const gc =
    byName.get(norm(x.title)) ??
    camps.find(
      (c) =>
        Math.abs(Number(c.mapY) - Number(x.mapy)) < 0.005 &&
        Math.abs(Number(c.mapX) - Number(x.mapx)) < 0.005 &&
        shares(core(c.facltNm), core(x.title)),
    );
  if (!gc) continue;
  const { items } = await call('detailPetTour2', { contentId: x.contentid });
  const d = items[0];
  if (!d) continue;
  out[gc.contentId] = {
    source: '한국관광공사 반려동물 동반여행',
    title: x.title,
    type: d.acmpyTypeCd || '',
    allowed: d.acmpyPsblCpam || '',
    need: d.acmpyNeedMtr || '',
    caution: d.relaAcdntRiskMtr || '',
    etc: (d.etcAcmpyInfo || '').slice(0, 400),
  };
}
writeFileSync(join(root, 'data', 'pet.json'), JSON.stringify({ syncedAt: new Date().toISOString(), count: Object.keys(out).length, byCamp: out }, null, 1));
console.log(`✅ 반려동물 동반 조건 ${Object.keys(out).length}곳 연결 → data/pet.json`);
