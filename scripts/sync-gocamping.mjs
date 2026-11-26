// 고캠핑 전체 목록을 받아 data/camps.json에 캐시해요. (기본 정보는 자주 안 바뀌므로 가끔만 실행)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const key = env.GOCAMPING_SERVICE_KEY;
if (!key) { console.error('❌ .env에 GOCAMPING_SERVICE_KEY가 없어요.'); process.exit(1); }

const FIELDS = ['contentId','facltNm','lineIntro','induty','lctCl','doNm','sigunguNm','addr1','mapX','mapY','tel','homepage','resveUrl','resveCl','operPdCl','operDeCl','manageSttus','sbrsCl','posblFcltyCl','themaEnvrnCl','animalCmgCl','trlerAcmpnyAt','caravAcmpnyAt','toiletCo','siteBottomCl1','siteBottomCl2','siteBottomCl3','siteBottomCl4','siteBottomCl5','firstImageUrl','modifiedtime','sitedStnc','allar','gnrlSiteCo','autoSiteCo','glampSiteCo','caravSiteCo','indvdlCaravSiteCo','intro','featureNm','tooltip','exprnProgrm','posblFcltyEtc'];

async function page(pageNo, numOfRows) {
  const url = new URL('https://apis.data.go.kr/B551011/GoCamping/basedList');
  url.search = new URLSearchParams({ serviceKey: key, numOfRows: String(numOfRows), pageNo: String(pageNo), MobileOS: 'ETC', MobileApp: 'StayScout', _type: 'json' }).toString();
  const res = await fetch(url);
  const data = JSON.parse(await res.text());
  const body = data?.response?.body;
  let items = body?.items?.item ?? [];
  if (!Array.isArray(items)) items = [items];
  return { total: Number(body?.totalCount ?? 0), items };
}

const size = 1000;
const first = await page(1, size);
let all = first.items;
const pages = Math.ceil(first.total / size);
for (let p = 2; p <= pages; p++) all = all.concat((await page(p, size)).items);

const slim = all.map((c) => Object.fromEntries(FIELDS.map((f) => [f, c[f] ?? ''])));
mkdirSync(join(root, 'data'), { recursive: true });
writeFileSync(join(root, 'data', 'camps.json'), JSON.stringify({ syncedAt: new Date().toISOString(), source: '한국관광공사 고캠핑 정보 조회서비스', count: slim.length, camps: slim }));
console.log(`✅ ${slim.length}곳 저장 (총 ${first.total}곳) → data/camps.json`);
