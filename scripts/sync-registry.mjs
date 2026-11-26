// 한국관광공사 전국 야영장 등록 현황(공공데이터포털 파일데이터 자동변환 API)을 받아
// 고캠핑 목록과 합쳐요. 고캠핑에 있는 곳은 사이트 크기 등을 보강하고, 없는 곳은 새로 추가해요(좌표는 카카오 주소 검색).
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
const kakao = env.KAKAO_REST_API_KEY;
const URL_ = 'https://api.odcloud.kr/api/15037499/v1/uddi:adf7c061-042d-4965-9b7c-87585251862b'; // 20260923 기준

let rows = [];
for (let page = 1; page < 20; page++) {
  const u = new URL(URL_);
  u.search = new URLSearchParams({ serviceKey: key, page: String(page), perPage: '1000', returnType: 'JSON' }).toString();
  const d = await (await fetch(u)).json();
  rows = rows.concat(d.data || []);
  if (!d.data?.length || rows.length >= d.totalCount) break;
}

const norm = (s) => String(s || '').replace(/\s|\(.*?\)|[&·,.\-_]|주식회사|\(주\)|㈜/g, '');
const core = (s) => norm(s).replace(/글램핑|캠핑장|캠핑|야영장|야영|오토|자연휴양림|휴양림|캠프|리조트|펜션|카라반|지점/g, '');
const roadKey = (a) => {
  const m = String(a || '').replace(/\(.*?\)/g, '').match(/(\S+(?:시|군|구))\s.*?(\S+(?:로|길))\s*(\d+(?:-\d+)?)/);
  return m ? m[1] + m[2] + m[3] : '';
};

const raw = JSON.parse(readFileSync(join(root, 'data', 'camps.json'), 'utf8'));
// 이전에 추가했던 등록 현황 캠핑장은 빼고 고캠핑 목록에서 다시 시작해요 (여러 번 실행해도 결과가 같게)
const camps = raw.camps.filter((c) => !String(c.contentId).startsWith('reg-'));
const byRoad = new Map();
for (const c of camps) {
  const k = roadKey(c.addr1);
  if (k) byRoad.set(k, c);
}
const byCore = new Map();
for (const c of camps) byCore.set(`${c.sigunguNm}|${core(c.facltNm)}`, c);

const n = (v) => Number(v || 0) || 0;
const siteSizes = (r) =>
  [1, 2, 3]
    .map((i) => ({ w: n(r[`사이트 크기${i} 가로`]), h: n(r[`사이트 크기${i} 세로`]), count: n(r[`사이트 크기${i} 수량`]) }))
    .filter((s) => s.w > 0 && s.h > 0 && s.count > 0);

let enriched = 0;
const added = [];
for (const r of rows) {
  const sizes = siteSizes(r);
  const match = byRoad.get(roadKey(r['주소'])) || byCore.get(`${r['시군구']}|${core(r['야영장명'])}`);
  if (match) {
    if (sizes.length) match.siteSizes = sizes;
    if (!match.animalCmgCl && r['반려동물출입']) match.animalCmgCl = r['반려동물출입'];
    if (!match.sbrsCl && r['부대시설']) match.sbrsCl = r['부대시설'];
    if (!Number(match.sitedStnc) && n(r['사이트간 거리'])) match.sitedStnc = String(n(r['사이트간 거리']));
    match.registered = true;
    enriched++;
    continue;
  }
  const induty = [
    n(r['주요시설 일반야영장']) && '일반야영장',
    n(r['주요시설 자동차야영장']) && '자동차야영장',
    n(r['주요시설 글램핑']) && '글램핑',
    n(r['주요시설 카라반']) && '카라반',
  ].filter(Boolean).join(',');
  added.push({
    contentId: `reg-${added.length + 1}`,
    facltNm: r['야영장명'] || r['인허가 사업장 명'],
    lineIntro: '',
    induty,
    lctCl: '',
    doNm: r['도'] || '',
    sigunguNm: r['시군구'] || '',
    addr1: r['주소'] || '',
    mapX: '',
    mapY: '',
    tel: '',
    homepage: '',
    resveUrl: '',
    resveCl: '',
    operPdCl: '',
    operDeCl: '',
    manageSttus: '운영',
    sbrsCl: r['부대시설'] || '',
    posblFcltyCl: r['주변이용가능시설'] || '',
    themaEnvrnCl: r['테마환경'] || '',
    animalCmgCl: r['반려동물출입'] || '',
    trlerAcmpnyAt: '',
    caravAcmpnyAt: '',
    toiletCo: '',
    siteBottomCl1: '', siteBottomCl2: '', siteBottomCl3: '', siteBottomCl4: '', siteBottomCl5: '',
    firstImageUrl: '',
    sitedStnc: String(n(r['사이트간 거리'])),
    gnrlSiteCo: String(n(r['주요시설 일반야영장'])),
    autoSiteCo: String(n(r['주요시설 자동차야영장'])),
    glampSiteCo: String(n(r['주요시설 글램핑'])),
    caravSiteCo: String(n(r['주요시설 카라반'])),
    indvdlCaravSiteCo: String(n(r['주요시설 개인 카라반'])),
    siteSizes: sizes,
    registered: true,
    source: '전국 야영장 등록 현황',
    permitDate: r['인허가일자'] || '',
  });
}

// 새로 추가된 곳은 카카오 주소 검색으로 좌표를 붙여요 (5개씩 동시에)
let geocoded = 0;
if (kakao) {
  for (let i = 0; i < added.length; i += 5) {
    await Promise.all(
      added.slice(i, i + 5).map(async (c) => {
        try {
          const r = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?size=1&query=${encodeURIComponent(c.addr1)}`, {
            headers: { Authorization: `KakaoAK ${kakao}` },
          });
          const doc = (await r.json()).documents?.[0];
          if (doc) {
            c.mapX = doc.x;
            c.mapY = doc.y;
            geocoded++;
          }
        } catch {}
      }),
    );
  }
}

// 좌표가 붙은 뒤, 고캠핑 캠핑장과 같은 곳이면 새로 추가하지 않고 합쳐요.
// 같은 곳 기준: 60m 이내이거나, 150m 이내이면서 지역명을 뺀 고유 이름이 3글자 이상 겹칠 때
const dist = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const dl = (b[0] - a[0]) * r, dg = (b[1] - a[1]) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dg / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const shares = (a, b) => { for (let i = 0; i + 3 <= a.length; i++) if (b.includes(a.slice(i, i + 3))) return true; return false; };
const local = (c) => core(c.facltNm).replace(new RegExp(String(c.sigunguNm).replace(/(시|군|구)$/, '') + '(시|군|구)?'), '');
const gcWithXY = camps.filter((c) => !String(c.contentId).startsWith('reg-') && Number(c.mapY));
let merged = 0;
const kept = [];
for (const a of added) {
  if (!Number(a.mapY)) { kept.push(a); continue; }
  const p = [Number(a.mapY), Number(a.mapX)];
  const same = gcWithXY.find((g) => {
    const d = dist(p, [Number(g.mapY), Number(g.mapX)]);
    return d < 60 || (d < 150 && shares(local(a), local(g)));
  });
  if (same) {
    if (a.siteSizes?.length && !same.siteSizes?.length) same.siteSizes = a.siteSizes;
    if (!same.animalCmgCl && a.animalCmgCl) same.animalCmgCl = a.animalCmgCl;
    same.registered = true;
    merged++;
  } else kept.push(a);
}
added.length = 0;
added.push(...kept);

raw.camps = camps.filter((c) => !String(c.contentId).startsWith('reg-')).concat(added);
raw.count = raw.camps.length;
raw.registrySyncedAt = new Date().toISOString();
writeFileSync(join(root, 'data', 'camps.json'), JSON.stringify(raw));
console.log(`✅ 등록 현황 ${rows.length}곳: 고캠핑 보강 ${enriched + merged}곳(위치로 합친 ${merged}곳 포함), 새로 추가 ${added.length}곳 (좌표 ${geocoded}곳 시도) → 전체 ${raw.camps.length}곳`);
