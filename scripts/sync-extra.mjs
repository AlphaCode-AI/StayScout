// 고캠핑 API의 추가 항목을 data/camps.json에 붙여요. (다른 출처로 보강한 내용은 그대로 둬요)
// 글램핑·카라반 내부시설(내부화장실 등), 화로대, 장비 대여, 화장실·샤워실·개수대 수, 기타 시설, 체험 프로그램
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const EXTRA = ['glampInnerFclty', 'caravInnerFclty', 'brazierCl', 'eqpmnLendCl', 'swrmCo', 'wtrplCo', 'sbrsEtc', 'exprnProgrmAt', 'clturEventAt', 'clturEvent', 'createdtime'];

const items = [];
for (let page = 1; page < 20; page++) {
  const u = new URL('https://apis.data.go.kr/B551011/GoCamping/basedList');
  u.search = new URLSearchParams({ serviceKey: env.GOCAMPING_SERVICE_KEY, numOfRows: '1000', pageNo: String(page), MobileOS: 'ETC', MobileApp: 'StayScout', _type: 'json' }).toString();
  const b = (await (await fetch(u, { signal: AbortSignal.timeout(60000) })).json()).response.body;
  const it = b.items?.item ?? [];
  items.push(...(Array.isArray(it) ? it : [it]));
  if (!it.length || items.length >= Number(b.totalCount)) break;
}
const byId = new Map(items.map((x) => [String(x.contentId), x]));

const file = join(root, 'data', 'camps.json');
const data = JSON.parse(readFileSync(file, 'utf8'));
let n = 0;
for (const c of data.camps) {
  const x = byId.get(String(c.contentId));
  if (!x) continue;
  n++;
  for (const k of EXTRA) if (x[k] !== undefined && x[k] !== '') c[k] = String(x[k]).trim();
}
writeFileSync(file, JSON.stringify(data));
const count = (k, re) => data.camps.filter((c) => re.test(c[k] || '')).length;
console.log(`✅ 추가 항목 ${n}곳: 글램핑 내부화장실 ${count('glampInnerFclty', /내부화장실/)} · 카라반 내부화장실 ${count('caravInnerFclty', /내부화장실/)} · 화로대 정보 ${count('brazierCl', /./)} · 장비 대여 ${count('eqpmnLendCl', /./)}`);
