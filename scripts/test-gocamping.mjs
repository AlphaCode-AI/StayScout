// 고캠핑 API 연결 테스트: 캠핑장 몇 곳을 받아와 핵심 필드를 보여주고 results/에 저장해요.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const key = env.GOCAMPING_SERVICE_KEY;
if (!key) {
  console.error('❌ .env 파일에 GOCAMPING_SERVICE_KEY(디코딩 키)를 넣어 주세요.');
  process.exit(1);
}

const keyword = process.argv[2] || '포천';
const url = new URL('https://apis.data.go.kr/B551011/GoCamping/searchList');
url.search = new URLSearchParams({
  serviceKey: key, // URLSearchParams가 인코딩해 주므로 디코딩 키를 써요
  numOfRows: '5',
  pageNo: '1',
  MobileOS: 'ETC',
  MobileApp: 'StayScout',
  _type: 'json',
  keyword,
}).toString();

const res = await fetch(url);
const text = await res.text();
let data;
try { data = JSON.parse(text); } catch {
  console.error(`❌ JSON이 아닌 응답이에요 (HTTP ${res.status}). 앞부분:\n${text.slice(0, 400)}`);
  process.exit(1);
}

mkdirSync(join(root, 'results'), { recursive: true });
const out = join(root, 'results', `gocamping-${keyword}.json`);
writeFileSync(out, JSON.stringify(data, null, 2));

const header = data?.response?.header;
const items = data?.response?.body?.items?.item ?? [];
const list = Array.isArray(items) ? items : [items];
console.log(`✅ HTTP ${res.status} · ${header?.resultMsg} · "${keyword}" 검색 결과 총 ${data?.response?.body?.totalCount ?? 0}곳 중 ${list.length}곳\n`);
for (const c of list) {
  console.log(`■ ${c.facltNm}  (${c.induty || '-'})`);
  console.log(`  주소: ${c.addr1 || '-'}`);
  console.log(`  좌표: ${c.mapY}, ${c.mapX}`);
  console.log(`  부대시설: ${c.sbrsCl || '-'}`);
  console.log(`  반려동물: ${c.animalCmgCl || '-'}`);
  console.log(`  예약: ${c.resveCl || '-'} ${c.resveUrl || ''}\n`);
}
console.log(`전체 응답 저장: results/gocamping-${keyword}.json`);
