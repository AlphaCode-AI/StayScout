// sync-public.mjs로 받은 인허가·자연휴양림 데이터를 data/camps.json에 붙여요.
// - license: 행정안전부 일반야영장업 인허가 (영업중/휴업/폐업, 인허가일)
// - forest: 전국 자연휴양림 표준데이터 (입장료, 수용인원, 주요시설)
// 몇 번을 돌려도 결과가 같아요(필드를 덮어써요).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
const campsFile = read('camps.json');
const license = read('license.json').items;
const forest = read('forest.json').items;

const GENERIC = /\s|\(.*?\)|주식회사|㈜|국립|공립|사립|자연휴양림|휴양림|일반야영장|자동차야영장|오토캠핑장|캠핑장|야영장|글램핑|캠핑|오토|캠프|리조트|펜션|앤/g;
const core = (s) => String(s || '').replace(GENERIC, '');
// 이름 핵심어가 서로 포함되거나 3글자 이상 겹치면 같은 곳으로 봐요.
function sameName(a, b) {
  const x = core(a), y = core(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  for (let i = 0; i + 3 <= x.length; i++) if (y.includes(x.slice(i, i + 3))) return true;
  return false;
}
const roadKey = (a) => {
  const m = String(a || '').replace(/\(.*?\)/g, '').match(/(\S+(?:시|군|구))\s.*?(\S+(?:로|길))\s*(\d+(?:-\d+)?)/);
  return m ? m[1] + m[2] + m[3] : '';
};
const lotKey = (a) => {
  const m = String(a || '').replace(/\(.*?\)/g, '').match(/(\S+(?:시|군|구))\s.*?(\S+(?:읍|면|동|리))\s*(?:산\s*)?(\d+(?:-\d+)?)/);
  return m ? m[1] + m[2] + m[3] : '';
};

const byKey = new Map();
const add = (k, x) => { if (!k) return; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(x); };
for (const x of license) { add(roadKey(x.road), x); add(lotKey(x.lot), x); }

const OPEN = (x) => /영업중|정상/.test(x.detail || x.status);
const fmt = (s) => String(s || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');

let matched = 0, closed = 0, rest = 0, forestHit = 0;
for (const c of campsFile.camps) {
  delete c.license;
  delete c.forest;
  const hits = [...new Set([...(byKey.get(roadKey(c.addr1)) || []), ...(byKey.get(lotKey(c.addr1)) || [])])]
    .filter((x) => sameName(x.name, c.facltNm));
  // 같은 자리(주소)에 이름과 상관없이 더 먼저 받은 인허가가 있으면 기억해 둬요.
  // 주인이 바뀌거나 이름을 바꿔 인허가를 새로 받은 곳을 "새로 연 곳"으로 잘못 보지 않게요.
  const sameSpot = [...new Set([...(byKey.get(roadKey(c.addr1)) || []), ...(byKey.get(lotKey(c.addr1)) || [])])];
  const firstPermit = sameSpot.map((x) => fmt(x.permit)).filter(Boolean).sort()[0];
  if (firstPermit) c.firstPermit = firstPermit;
  else delete c.firstPermit;
  if (hits.length) {
    matched++;
    // 같은 이름으로 영업중 기록이 하나라도 있으면 영업중으로 봐요.
    const best = hits.find(OPEN) || hits.sort((a, b) => String(b.closed).localeCompare(String(a.closed)))[0];
    c.license = { status: best.detail || best.status, permit: fmt(best.permit), closed: fmt(best.closed), name: best.name };
    if (!OPEN(best)) (/휴업/.test(c.license.status) ? rest++ : closed++);
  }
  if (/휴양림/.test(c.facltNm)) {
    const f = forest.find((f) => sameName(f.name, c.facltNm) && (!f.address || !c.sigunguNm || f.address.includes(c.sigunguNm)));
    if (f) {
      forestHit++;
      c.forest = { name: f.name, type: f.type, capacity: f.capacity, fee: f.fee, facilities: f.facilities, tel: f.tel, homepage: f.homepage };
    }
  }
}

writeFileSync(join(root, 'data', 'camps.json'), JSON.stringify(campsFile));
console.log(`✅ 인허가 연결 ${matched}곳 (폐업·말소 ${closed}곳, 휴업 ${rest}곳) · 자연휴양림 정보 ${forestHit}곳`);
