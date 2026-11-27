/**
 * 펜션 데이터 받기·합치기
 *   node scripts/sync-pension.mjs rural    행정안전부 농어촌민박업 인허가 (약 5.6만 건, 100건씩, 끊기면 이어 받기)
 *   node scripts/sync-pension.mjs tourist  행정안전부 관광펜션업 인허가 (약 1.7천 건)
 *   node scripts/sync-pension.mjs lodging  행정안전부 숙박업 인허가 (호텔·모텔 포함 전체를 받고, merge에서 펜션·풀빌라 이름만 골라요)
 *   node scripts/sync-pension.mjs tour     한국관광공사 숙박 정보 중 펜션 (목록 + 소개·객실·시설, 하루 호출 한도가 있어 나눠 받기)
 *   node scripts/sync-pension.mjs merge    네 데이터를 합쳐 data/pensions.json 만들기
 * 각 단계는 data/.cache/pension/ 에 쪽마다 저장해 두고, 다시 실행하면 받은 쪽은 건너뛰어요.
 * 인증키: .env 의 GOCAMPING_SERVICE_KEY (공공데이터포털 같은 키)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const env = Object.fromEntries(
  (existsSync(join(root, '.env')) ? readFileSync(join(root, '.env'), 'utf8') : '')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const KEY = process.env.GOCAMPING_SERVICE_KEY || env.GOCAMPING_SERVICE_KEY;
const CACHE = join(root, 'data', '.cache', 'pension');
const BUDGET = Number(process.env.BUDGET_MS || 150_000); // 한 번 실행에 쓰는 시간 (도구 제한 대비)
const started = Date.now();
const timeLeft = () => Date.now() - started < BUDGET;
mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(40_000) });
      const t = await r.text();
      if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS/.test(t)) return { limited: true };
      const j = JSON.parse(t);
      return j;
    } catch {
      await sleep(1500 * (i + 1));
    }
  }
  return null;
}

// ---------------------------------------------------------------- 인허가 (행안부)
async function license(name, dir) {
  const d = join(CACHE, dir);
  mkdirSync(d, { recursive: true });
  const base = `https://apis.data.go.kr/1741000/${name}/info`;
  const q = (p) => `${base}?${new URLSearchParams({ serviceKey: KEY, pageNo: String(p), numOfRows: '100', returnType: 'json' })}`;
  let total = existsSync(join(d, 'total.json')) ? JSON.parse(readFileSync(join(d, 'total.json'), 'utf8')).total : 0;
  if (!total) {
    const j = await getJson(q(1));
    total = j?.response?.body?.totalCount;
    if (!total) throw new Error(`${name}: 전체 건수를 못 받았어요`);
    writeFileSync(join(d, 'total.json'), JSON.stringify({ total }));
  }
  const pages = Math.ceil(total / 100);
  let got = 0;
  // 한 쪽에 100건이 최대라 쪽이 많아요(숙박업 약 600쪽). 몇 쪽씩 동시에 받아요.
  const todo = [];
  for (let p = 1; p <= pages; p++) if (!existsSync(join(d, `p${p}.json`))) todo.push(p);
  const worker = async () => {
    while (todo.length && timeLeft()) {
      const p = todo.shift();
      const j = await getJson(q(p));
      const items = j?.response?.body?.items?.item;
      if (!Array.isArray(items)) continue; // 다음 실행에서 다시 받아요
      writeFileSync(join(d, `p${p}.json`), JSON.stringify(items));
      got++;
    }
  };
  await Promise.all(Array.from({ length: Number(process.env.CONC || 6) }, worker));
  const have = readdirSync(d).filter((x) => /^p\d+\.json$/.test(x)).length;
  console.log(`${name}: ${have}/${pages}쪽 (이번에 ${got}쪽)${have < pages ? ' → 다시 실행하면 이어 받아요' : ' 완료'}`);
}

// ---------------------------------------------------------------- 관광공사 숙박 (펜션)
const TOUR = 'https://apis.data.go.kr/B551011/KorService2/';
const tq = (op, params) => `${TOUR}${op}?${new URLSearchParams({ serviceKey: KEY, MobileOS: 'ETC', MobileApp: 'StayScout', _type: 'json', ...params })}`;
async function tour() {
  const d = join(CACHE, 'tour');
  mkdirSync(d, { recursive: true });
  const listFile = join(d, 'list.json');
  if (!existsSync(listFile)) {
    const all = [];
    for (let p = 1; p < 10; p++) {
      const j = await getJson(tq('areaBasedList2', { contentTypeId: '32', numOfRows: '1000', pageNo: String(p) }));
      const it = j?.response?.body?.items?.item ?? [];
      all.push(...it);
      if (it.length < 1000) break;
    }
    // 펜션(AC030100)과 한옥·민박 중 이름에 펜션이 들어간 곳
    const pens = all.filter((x) => x.lclsSystm3 === 'AC030100' || /펜션|풀빌라/.test(x.title));
    writeFileSync(listFile, JSON.stringify(pens));
    console.log(`관광공사 숙박 ${all.length}곳 중 펜션 ${pens.length}곳`);
  }
  const pens = JSON.parse(readFileSync(listFile, 'utf8'));
  let calls = 0;
  for (const op of ['detailCommon2', 'detailIntro2', 'detailInfo2']) {
    const od = join(d, op);
    mkdirSync(od, { recursive: true });
    for (const x of pens) {
      if (!timeLeft()) break;
      const f = join(od, `${x.contentid}.json`);
      if (existsSync(f)) continue;
      const params = op === 'detailCommon2' ? { contentId: x.contentid } : { contentId: x.contentid, contentTypeId: '32' };
      const j = await getJson(tq(op, params));
      calls++;
      if (j?.limited) {
        console.log(`관광공사 하루 호출 한도에 걸렸어요. 내일 다시 실행하면 이어 받아요. (${op})`);
        return;
      }
      const it = j?.response?.body?.items?.item;
      if (j?.response?.body) writeFileSync(f, JSON.stringify(Array.isArray(it) ? it : it ? [it] : []));
    }
    const have = readdirSync(od).length;
    console.log(`${op}: ${have}/${pens.length}`);
  }
  console.log(`이번 호출 ${calls}번`);
}

// ---------------------------------------------------------------- 좌표 변환 (EPSG:5174 Bessel 중부원점 TM → WGS84)
const DEG = Math.PI / 180;
function tmToBessel(x, y) {
  const a = 6377397.155, f = 1 / 299.1528128, e2 = 2 * f - f * f;
  const k0 = 1, lat0 = 38 * DEG, lon0 = 127.0028902777778 * DEG, x0 = 200000, y0 = 500000;
  const e4 = e2 * e2, e6 = e4 * e2;
  const M = (p) => a * ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * p - ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * p) + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * p) - ((35 * e6) / 3072) * Math.sin(6 * p));
  const mu = (M(lat0) + (y - y0) / k0) / (a * (1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const ep2 = e2 / (1 - e2);
  const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1);
  const C1 = ep2 * c * c, T1 = t * t, N1 = a / Math.sqrt(1 - e2 * s * s), R1 = (a * (1 - e2)) / (1 - e2 * s * s) ** 1.5, D = (x - x0) / (N1 * k0);
  const lat = p1 - ((N1 * t) / R1) * ((D * D) / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = lon0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / c;
  return [lat, lon];
}
function besselToWgs84([lat, lon]) {
  const toXYZ = (la, lo, a, e2) => {
    const N = a / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
    return [N * Math.cos(la) * Math.cos(lo), N * Math.cos(la) * Math.sin(lo), N * (1 - e2) * Math.sin(la)];
  };
  const fb = 1 / 299.1528128, ab = 6377397.155, e2b = 2 * fb - fb * fb;
  const [X, Y, Z] = toXYZ(lat, lon, ab, e2b);
  const [tx, ty, tz] = [-115.8, 474.99, 674.11];
  const sec = Math.PI / (180 * 3600);
  const [rx, ry, rz] = [1.16 * sec, -2.31 * sec, -1.63 * sec];
  const k = 1 + 6.43e-6;
  const X2 = tx + k * (X - rz * Y + ry * Z), Y2 = ty + k * (rz * X + Y - rx * Z), Z2 = tz + k * (-ry * X + rx * Y + Z);
  const aw = 6378137, fw = 1 / 298.257223563, e2w = 2 * fw - fw * fw;
  const p = Math.hypot(X2, Y2);
  let la = Math.atan2(Z2, p * (1 - e2w));
  for (let i = 0; i < 6; i++) {
    const N = aw / Math.sqrt(1 - e2w * Math.sin(la) ** 2);
    la = Math.atan2(Z2 + e2w * N * Math.sin(la), p);
  }
  return [la / DEG, Math.atan2(Y2, X2) / DEG];
}
const toWgs = (x, y) => (Number(x) && Number(y) ? besselToWgs84(tmToBessel(Number(x), Number(y))) : null);

// ---------------------------------------------------------------- 합치기
const norm = (s) => (s || '').replace(/\(주\)|주식회사/g, '').toLowerCase().replace(/[\s&·.,()[\]'"!?~\-_/]/g, '').replace(/(펜션|풀빌라|민박)$/, '');
const dist = (a, b) => {
  const R = 6371000, dLat = (b[0] - a[0]) * DEG, dLon = (b[1] - a[1]) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * DEG) * Math.cos(b[0] * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
function readPages(dir) {
  const d = join(CACHE, dir);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter((x) => /^p\d+\.json$/.test(x)).flatMap((x) => JSON.parse(readFileSync(join(d, x), 'utf8')));
}
const areaOf = (addr) => {
  const t = (addr || '').split(/\s+/);
  return { doNm: t[0] || '', sigunguNm: t[1] || '' };
};
const ymd = (s) => (s || '').replace(/[^0-9-]/g, '').slice(0, 10);
const isPensionName = (n) => /펜션|풀빌라|pension|pool\s*villa/i.test(n);

// 숙박업 중 펜션으로 볼 곳: 이름에 펜션·풀빌라처럼 분명한 말이 있거나, "스테이·빌라·하우스"면서 읍·면(시골)에 있는 곳.
// 도시의 "○○스테이"(생활숙박·호텔)는 빼요. 호텔·콘도 업태도 빼요.
const LODGING_PENSION = /펜션|풀빌라|독채|글램핑|카라반|민박|산장|별장/;
const LODGING_MAYBE = /스테이|빌라|하우스|stay|villa|house/i;
const LODGING_NOT = /모텔|호텔|여관|여인숙|게스트\s*하우스|호스텔|레지던스|비즈니스|무인텔|hotel|motel/i;
const LODGING_TYPES = /숙박업\(생활\)|숙박업 기타|여관업|여인숙업/;
const isRural = (addr) => /\S+[읍면]\s/.test(addr || '');
const lodgingPension = (x) => {
  const n = x.BPLC_NM || '', addr = x.ROAD_NM_ADDR || x.LOTNO_ADDR || '';
  if (!LODGING_TYPES.test(x.BZSTAT_SE_NM || '') || LODGING_NOT.test(n)) return false;
  return LODGING_PENSION.test(n) || (LODGING_MAYBE.test(n) && isRural(addr));
};

// 인허가에 좌표가 없는 곳은 geocode 단계에서 카카오로 주소를 좌표로 바꿔 둬요
const GEO_FILE = join(CACHE, 'geo.json');
const geo = existsSync(GEO_FILE) ? JSON.parse(readFileSync(GEO_FILE, 'utf8')) : {};
const cleanAddr = (a) => (a || '').split(',')[0].replace(/\s+\d+동\(.*$/, '').replace(/\s*\(.*\)\s*$/, '').trim();

function fromLicense(x, source) {
  const addr = (x.ROAD_NM_ADDR || x.LOTNO_ADDR || '').split(',')[0].trim();
  const coords = toWgs(x.CRD_INFO_X, x.CRD_INFO_Y) || geo[cleanAddr(x.ROAD_NM_ADDR)] || geo[cleanAddr(x.LOTNO_ADDR)] || null;
  return {
    contentId: `pen-${x.OPN_ATMY_GRP_CD}-${x.MNG_NO}`, // 관리번호는 지자체마다 겹칠 수 있어서 지자체 코드를 붙여요
    kind: 'pension',
    facltNm: (x.BPLC_NM || '').trim(),
    addr1: addr,
    ...areaOf(addr),
    mapY: coords ? coords[0].toFixed(6) : '',
    mapX: coords ? coords[1].toFixed(6) : '',
    tel: (x.TELNO || '').trim(),
    roomCount: Number(x.GSRM_CNT) || Number(x.KSRM_CNT) + Number(x.WSRM_CNT) || undefined, // 숙박업은 한실·양실 수
    permitDate: ymd(x.LCPMT_YMD),
    source,
    tourPension: source === '관광펜션업',
    pensionType: source !== '농어촌민박업' || isPensionName(x.BPLC_NM) ? '펜션' : '민박',
    induty: source === '관광펜션업' ? '관광펜션' : source === '숙박업' ? '숙박업' : '농어촌민박',
    manageSttus: '운영',
  };
}

// ---------------------------------------------------------------- 좌표 없는 곳 (카카오 주소 검색)
async function geocode() {
  const KAKAO = process.env.KAKAO_REST_API_KEY || env.KAKAO_REST_API_KEY;
  if (!KAKAO) throw new Error('.env에 KAKAO_REST_API_KEY가 필요해요');
  const open = (x) => /영업|정상/.test(x.SALS_STTS_NM || '') && !/폐업|휴업|취소|말소/.test(x.SALS_STTS_NM || '');
  const need = [...readPages('rural'), ...readPages('tourist'), ...readPages('lodging').filter(lodgingPension)]
    .filter((x) => open(x) && !toWgs(x.CRD_INFO_X, x.CRD_INFO_Y))
    .map((x) => cleanAddr(x.ROAD_NM_ADDR) || cleanAddr(x.LOTNO_ADDR))
    .filter((a) => a && !(a in geo));
  const todo = [...new Set(need)];
  let found = 0, done = 0;
  const worker = async () => {
    while (todo.length && timeLeft()) {
      const a = todo.shift();
      try {
        const r = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(a)}`, { headers: { Authorization: `KakaoAK ${KAKAO}` }, signal: AbortSignal.timeout(10_000) });
        if (!r.ok) continue;
        const d = (await r.json()).documents?.[0];
        geo[a] = d ? [Number(d.y), Number(d.x)] : null;
        if (d) found++;
        done++;
      } catch {
        // 다음 실행에서 다시
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  writeFileSync(GEO_FILE, JSON.stringify(geo));
  console.log(`주소 → 좌표: 이번에 ${done}곳 조회, ${found}곳 찾음 · 남은 주소 ${todo.length}`);
}

function merge() {
  const open = (x) => /영업|정상/.test(x.SALS_STTS_NM || '') && !/폐업|휴업|취소|말소/.test(x.SALS_STTS_NM || '');
  const rural = readPages('rural').filter(open).map((x) => fromLicense(x, '농어촌민박업'));
  const tourist = readPages('tourist').filter(open).map((x) => fromLicense(x, '관광펜션업'));
  // 숙박업: 객실이 많은 단지형 펜션·풀빌라는 농어촌민박이 아니라 숙박업으로 신고해요. 호텔·모텔은 빼고 펜션식 이름만.
  const lodging = readPages('lodging')
    .filter(open)
    .filter(lodgingPension)
    .map((x) => fromLicense(x, '숙박업'));
  console.log(`영업 중: 농어촌민박 ${rural.length} · 관광펜션 ${tourist.length} · 숙박업 중 펜션식 이름 ${lodging.length}`);

  // 같은 곳 찾기용 격자 (약 1km)
  const grid = new Map();
  const cell = (la, lo) => `${Math.round(la * 100)}:${Math.round(lo * 100)}`;
  const put = (p) => {
    if (!p.mapY) return;
    const k = cell(+p.mapY, +p.mapX);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  };
  const near = (la, lo) => {
    const out = [];
    for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) out.push(...(grid.get(`${Math.round(la * 100) + dy}:${Math.round(lo * 100) + dx}`) || []));
    return out;
  };
  const byAddr = new Map();
  const list = [];
  const add = (p) => {
    list.push(p);
    put(p);
    if (p.addr1) byAddr.set(p.addr1.replace(/\s+/g, ''), p);
  };
  const findSame = (name, addr, la, lo) => {
    const a = addr && byAddr.get(addr.replace(/\s+/g, ''));
    if (a && (norm(a.facltNm) === norm(name) || !name)) return a;
    if (la && lo) {
      const n = norm(name);
      return near(la, lo).find((p) => p.mapY && dist([la, lo], [+p.mapY, +p.mapX]) < 150 && n && (norm(p.facltNm).includes(n) || n.includes(norm(p.facltNm))));
    }
    return undefined;
  };

  for (const p of rural) add(p);
  let both = 0;
  for (const p of tourist) {
    const s = findSame(p.facltNm, p.addr1, +p.mapY, +p.mapX);
    if (s) {
      s.tourPension = true;
      s.pensionType = '펜션';
      s.induty = '관광펜션';
      both++;
    } else add(p);
  }
  console.log(`관광펜션 중 농어촌민박과 같은 곳 ${both}곳 (관광펜션 지정 표시)`);
  let lodgingSame = 0;
  for (const p of lodging) {
    if (findSame(p.facltNm, p.addr1, +p.mapY, +p.mapX)) lodgingSame++;
    else add(p);
  }
  console.log(`숙박업 펜션 중 이미 있는 곳 ${lodgingSame}곳 · 새로 추가 ${lodging.length - lodgingSame}곳`);

  // 관광공사 상세
  const td = join(CACHE, 'tour');
  const tourList = existsSync(join(td, 'list.json')) ? JSON.parse(readFileSync(join(td, 'list.json'), 'utf8')) : [];
  const read = (op, id) => {
    const f = join(td, op, `${id}.json`);
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
  };
  let matched = 0, added = 0;
  for (const t of tourList) {
    const la = Number(t.mapy), lo = Number(t.mapx);
    const common = read('detailCommon2', t.contentid)?.[0] || {};
    const intro = read('detailIntro2', t.contentid)?.[0] || {};
    const rooms = (read('detailInfo2', t.contentid) || []).map((r) => ({
      name: r.roomtitle,
      base: Number(r.roombasecount) || undefined,
      max: Number(r.roommaxcount) || undefined,
      size: Number(r.roomsize2) || (Number(r.roomsize1) ? Math.round(Number(r.roomsize1) * 3.3058) : undefined), // ㎡
      cook: r.roomcook === 'Y',
      bath: r.roombath === 'Y',
      bathFacility: r.roombathfacility === 'Y',
      price: Number(r.roomoffseasonminfee1) || undefined, // 비수기 주중 최저
      prices: {
        offWeekday: Number(r.roomoffseasonminfee1) || undefined,
        offWeekend: Number(r.roomoffseasonminfee2) || undefined,
        peakWeekday: Number(r.roompeakseasonminfee1) || undefined,
        peakWeekend: Number(r.roompeakseasonminfee2) || undefined,
      },
      image: r.roomimg1 || undefined,
    }));
    const extra = {
      tourId: t.contentid,
      firstImageUrl: t.firstimage || '',
      intro: (common.overview || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim(),
      homepage: (common.homepage || '').match(/href="([^"]+)"/)?.[1] || '',
      resveUrl: (intro.reservationurl || '').match(/href="([^"]+)"/)?.[1] || intro.reservationurl || '',
      resveCl: intro.reservationlodging || '',
      roomType: intro.roomtype || '',
      cookCl: intro.chkcooking || '',
      subfacility: intro.subfacility || '',
      bbqYn: intro.barbecue === '1',
      saunaYn: intro.sauna === '1',
      campfireYn: intro.campfire === '1',
      karaokeYn: intro.karaoke === '1',
      checkin: intro.checkintime || '',
      checkout: intro.checkouttime || '',
      parking: intro.parkinglodging || '',
      pickup: intro.pickup || '',
      refund: intro.refundregulation || '',
      rooms: rooms.length ? rooms : undefined,
      tel: t.tel || intro.infocenterlodging || '',
      createdtime: t.createdtime ? `${t.createdtime.slice(0, 4)}-${t.createdtime.slice(4, 6)}-${t.createdtime.slice(6, 8)}` : '',
      modifiedtime: t.modifiedtime || '',
    };
    if (!extra.roomCount && intro.roomcount) extra.roomCount = Number(String(intro.roomcount).replace(/[^0-9]/g, '')) || undefined;
    const s = findSame(t.title, t.addr1, la, lo);
    if (s) {
      Object.assign(s, Object.fromEntries(Object.entries(extra).filter(([k, v]) => v !== '' && v !== undefined && !(k === 'tel' && s.tel))));
      s.pensionType = '펜션';
      matched++;
    } else {
      add({
        contentId: `pen-t${t.contentid}`,
        kind: 'pension',
        facltNm: t.title,
        addr1: t.addr1 || '',
        ...areaOf(t.addr1),
        mapY: la ? String(la) : '',
        mapX: lo ? String(lo) : '',
        source: '한국관광공사',
        pensionType: '펜션',
        induty: '펜션',
        manageSttus: '운영',
        ...extra,
      });
      added++;
    }
  }
  console.log(`관광공사 펜션 ${tourList.length}곳: 인허가와 연결 ${matched} · 새로 추가 ${added}`);
  const pens = list.filter((p) => p.facltNm && p.mapY);
  const out = { syncedAt: new Date().toISOString(), count: pens.length, pensions: pens };
  writeFileSync(join(root, 'data', 'pensions.json'), JSON.stringify(out));
  const types = pens.reduce((a, p) => ((a[p.pensionType] = (a[p.pensionType] || 0) + 1), a), {});
  console.log(`data/pensions.json: ${pens.length}곳`, types, `좌표 없음 제외 ${list.length - pens.length}`);
}

const step = process.argv[2];
if (!KEY && step !== 'merge') throw new Error('.env에 GOCAMPING_SERVICE_KEY가 필요해요');
if (step === 'rural') await license('rural_homestays', 'rural');
else if (step === 'tourist') await license('tourist_pensions', 'tourist');
else if (step === 'lodging') await license('lodgings', 'lodging');
else if (step === 'geocode') await geocode();
else if (step === 'tour') await tour();
else if (step === 'merge') merge();
else console.log('사용법: node scripts/sync-pension.mjs rural|tourist|lodging|geocode|tour|merge');
