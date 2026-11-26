import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Verdict, PetSize } from './types';
import { toUrl } from './links';

export interface Camp {
  contentId: string;
  facltNm: string;
  lineIntro: string;
  induty: string;
  lctCl: string;
  doNm: string;
  sigunguNm: string;
  addr1: string;
  mapX: string;
  mapY: string;
  tel: string;
  homepage: string;
  resveUrl: string;
  resveCl: string;
  operPdCl: string;
  operDeCl: string;
  manageSttus: string;
  sbrsCl: string;
  posblFcltyCl: string;
  themaEnvrnCl: string;
  animalCmgCl: string;
  trlerAcmpnyAt: string;
  caravAcmpnyAt: string;
  toiletCo: string;
  siteBottomCl1: string;
  siteBottomCl2: string;
  siteBottomCl3: string;
  siteBottomCl4: string;
  siteBottomCl5: string;
  firstImageUrl: string;
  sitedStnc?: string;
  allar?: string;
  gnrlSiteCo?: string;
  autoSiteCo?: string;
  glampSiteCo?: string;
  caravSiteCo?: string;
  indvdlCaravSiteCo?: string;
  intro?: string;
  featureNm?: string;
  tooltip?: string;
  posblFcltyEtc?: string;
  siteSizes?: { w: number; h: number; count: number }[]; // 전국 야영장 등록 현황의 사이트 크기(m)
  registered?: boolean; // 전국 야영장 등록 현황에 있음
  modifiedtime?: string; // 고캠핑 갱신일
  glampInnerFclty?: string; // 글램핑 객실 내부시설 (내부화장실 등)
  caravInnerFclty?: string; // 카라반 내부시설
  brazierCl?: string; // 화로대: 개별/공동취사장/불가
  eqpmnLendCl?: string; // 장비 대여
  swrmCo?: string; // 샤워실 수
  wtrplCo?: string; // 개수대 수
  sbrsEtc?: string; // 기타 부대시설
  exprnProgrmAt?: string; // 체험 프로그램 있음(Y/N)
  exprnProgrm?: string;
  source?: string; // 고캠핑 외 출처로 추가된 곳
  permitDate?: string;
  license?: { status: string; permit: string; closed: string; name: string }; // 행안부 일반야영장업 인허가
  firstPermit?: string; // 같은 자리(주소)에서 가장 먼저 받은 인허가일 (주인·이름이 바뀐 곳 구별용)
  createdtime?: string; // 관광공사 캠핑장 정보에 처음 등록된 날
  forest?: { name: string; type: string; capacity: string; fee: string; facilities: string; tel: string; homepage: string }; // 자연휴양림 표준데이터
  // ---- 펜션·민박 (scripts/sync-pension.mjs) ----
  kind?: 'camp' | 'pension';
  pensionType?: '펜션' | '민박';
  tourPension?: boolean; // 관광펜션업 지정
  roomCount?: number; // 객실 수 (인허가)
  tourId?: string; // 관광공사 숙박 정보 연결
  roomType?: string; // 객실 유형 (독채·복층 등)
  cookCl?: string; // 취사 가능 여부
  subfacility?: string; // 부대시설 (수영장·바비큐장 등)
  bbqYn?: boolean;
  saunaYn?: boolean;
  campfireYn?: boolean;
  checkin?: string;
  checkout?: string;
  parking?: string;
  refund?: string;
  rooms?: { name: string; base?: number; max?: number; size?: number; cook?: boolean; bath?: boolean; bathFacility?: boolean; price?: number; prices?: Partial<Record<PriceSlot, number>>; image?: string }[];
}

export type Category = 'camp' | 'pension';
export const CATEGORY_LABEL: Record<Category, string> = { camp: '캠핑장', pension: '펜션·민박' };
export const categoryOf = (c: Camp): Category => c.kind ?? 'camp';
/** 펜션 최대 수용 인원 (객실 정보가 있는 곳만) */
export const maxPeople = (c: Camp) => Math.max(0, ...(c.rooms ?? []).map((r) => r.max ?? 0)) || undefined;
/** 가격 구분: 관광공사 객실 정보의 비수기·성수기 × 주중·주말 최저가 */
export type PriceSlot = 'offWeekday' | 'offWeekend' | 'peakWeekday' | 'peakWeekend';
export const SLOT_LABEL: Record<PriceSlot, string> = { offWeekday: '비수기 주중', offWeekend: '비수기 주말', peakWeekday: '성수기 주중', peakWeekend: '성수기 주말' };
/** 체크인 날짜로 가격 구분을 정해요. 성수기는 7/15~8/25, 주말은 금·토요일 밤 */
export function slotOf(checkIn?: string): PriceSlot | undefined {
  if (!checkIn) return undefined;
  const d = new Date(`${checkIn}T00:00:00`);
  if (isNaN(+d)) return undefined;
  const md = (d.getMonth() + 1) * 100 + d.getDate();
  const peak = md >= 715 && md <= 825;
  const weekend = d.getDay() === 5 || d.getDay() === 6;
  return `${peak ? 'peak' : 'off'}${weekend ? 'Weekend' : 'Weekday'}` as PriceSlot;
}
/** 펜션 객실 최저가. 구분을 주면 그 구분 가격, 없으면 비수기 주중 */
export const minPrice = (c: Camp, slot: PriceSlot = 'offWeekday') => {
  const ps = (c.rooms ?? []).map((r) => r.prices?.[slot] ?? (slot === 'offWeekday' ? r.price : undefined) ?? 0).filter((x) => x > 0);
  return ps.length ? Math.min(...ps) : undefined;
};

/** 행안부 인허가에 같은 이름으로 휴업·폐업·말소 기록만 있는 곳 */
export function licenseClosed(c: Camp) {
  return !!c.license && !/영업중|정상/.test(c.license.status);
}

let cache: { camps: Camp[]; syncedAt: string } | null = null;

/** scripts/sync-gocamping.mjs 로 받아 둔 고캠핑 캐시를 읽어요. */
let cacheStamp = '';
export function loadCamps() {
  // data/ 파일을 다시 받으면(sync) 서버를 재시작하지 않아도 새로 읽어요
  const stamp = ['camps.json', 'pensions.json'].map((f) => { try { return statSync(join(process.cwd(), 'data', f)).mtimeMs; } catch { return 0; } }).join(':');
  if (cache && stamp !== cacheStamp) cache = null;
  cacheStamp = stamp;
  if (!cache) {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'camps.json'), 'utf8'));
    const camps = raw.camps as Camp[];
    // 펜션·민박도 같은 목록에 넣고, 검색할 때 카테고리로 나눠요 (kind: 'pension')
    const pf = join(process.cwd(), 'data', 'pensions.json');
    if (existsSync(pf)) {
      const blank = { lineIntro: '', lctCl: '', homepage: '', resveUrl: '', resveCl: '', operPdCl: '', operDeCl: '', sbrsCl: '', posblFcltyCl: '', themaEnvrnCl: '', animalCmgCl: '', trlerAcmpnyAt: '', caravAcmpnyAt: '', toiletCo: '', siteBottomCl1: '', siteBottomCl2: '', siteBottomCl3: '', siteBottomCl4: '', siteBottomCl5: '', firstImageUrl: '', tel: '' };
      for (const p of JSON.parse(readFileSync(pf, 'utf8')).pensions as Partial<Camp>[]) camps.push({ ...blank, ...p } as Camp);
    }
    cache = { camps, syncedAt: raw.syncedAt as string };
  }
  return cache;
}

/** 출발지 좌표 (길찾기 API 연결 전까지 쓰는 대략적인 도심 좌표) */
export const ORIGINS: Record<string, [number, number]> = {
  서울: [37.5665, 126.978],
  강남: [37.4979, 127.0276],
  성남: [37.42, 127.1265],
  분당: [37.3826, 127.1189],
  판교: [37.3947, 127.1112],
  과천: [37.4292, 126.9876],
  안양: [37.3943, 126.9568],
  수원: [37.2636, 127.0286],
  용인: [37.2411, 127.1776],
  하남: [37.5393, 127.2149],
  고양: [37.6584, 126.832],
  일산: [37.6584, 126.77],
  인천: [37.4563, 126.7052],
  평택: [36.9921, 127.1129],
  천안: [36.8151, 127.1139],
  세종: [36.48, 127.289],
  청주: [36.6424, 127.489],
  대전: [36.3504, 127.3845],
  춘천: [37.8813, 127.7298],
  원주: [37.3422, 127.9202],
  대구: [35.8714, 128.6014],
  부산: [35.1796, 129.0756],
  울산: [35.5384, 129.3114],
};

export interface PetInfo {
  source: string;
  title: string;
  type: string; // 전구역/일부구역 동반가능
  allowed: string; // 동반 가능 반려동물
  need: string; // 필요 사항
  caution: string;
  etc: string;
}

let petCache: Record<string, PetInfo> | null = null;

/** scripts/sync-pettour.mjs 로 받아 둔 반려동물 동반 조건 (없으면 빈 객체) */
export function loadPetInfo(): Record<string, PetInfo> {
  if (!petCache) {
    const f = join(process.cwd(), 'data', 'pet.json');
    petCache = existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')).byCamp as Record<string, PetInfo>) : {};
  }
  return petCache;
}

/** 관광공사 반려동물 조건 문구로 크기별 동반 가능 여부를 판정해요 */
function petFromTour(p: PetInfo, petSize?: PetSize): { v: Verdict; text: string } {
  const a = `${p.allowed} ${p.caution}`;
  const kg = a.match(/(\d+(?:\.\d+)?)\s*kg/i);
  const limit = kg ? Number(kg[1]) : undefined;
  const all = /전\s*견종/.test(a);
  const smallOnly = /소형/.test(a) && !/중|대형/.test(a) && !all;
  const text = `관광공사: ${[p.allowed || '동반 가능', p.type].filter(Boolean).join(' · ')}`;
  if (petSize === 'big') {
    if (smallOnly || (limit !== undefined && limit < 10)) return { v: 'no', text };
    if (all && (limit === undefined || limit >= 15)) return { v: 'yes', text };
    return { v: 'likely', text };
  }
  if (petSize === 'small') return { v: 'yes', text };
  if (petSize === 'mid') {
    if (limit !== undefined) return limit >= 10 ? { v: 'yes', text } : limit <= 5 ? { v: 'no', text } : { v: 'unknown', text: `${text} · 몸무게 기준 확인 필요` };
    if (smallOnly) return { v: 'unknown', text: `${text} · 소형견 기준(5~10kg)이 곳마다 달라요` };
    return { v: 'yes', text };
  }
  return { v: smallOnly || limit !== undefined ? 'unknown' : 'yes', text };
}

/** 출발지 좌표: 주요 도시 표 → 없으면 같은 시·군 캠핑장 좌표의 평균 */
export function originCoords(name?: string): [number, number] | undefined {
  if (!name) return undefined;
  if (ORIGINS[name]) return ORIGINS[name];
  const hits = loadCamps().camps.filter((c) => c.sigunguNm.replace(/(시|군|구)$/, '') === name && Number(c.mapY));
  if (!hits.length) return undefined;
  return [hits.reduce((a, c) => a + Number(c.mapY), 0) / hits.length, hits.reduce((a, c) => a + Number(c.mapX), 0) / hits.length];
}

/** 시·도 별칭 → doNm 값들 */
export const PROVINCES: Record<string, string[]> = {
  서울: ['서울특별시'],
  경기: ['경기도'],
  인천: ['인천광역시'],
  강원: ['강원특별자치도', '강원도'],
  충남: ['충청남도'],
  충청남도: ['충청남도'],
  충북: ['충청북도'],
  충청북도: ['충청북도'],
  전북: ['전북특별자치도', '전라북도'],
  전라북도: ['전북특별자치도', '전라북도'],
  전남: ['전남광주통합특별시'],
  전라남도: ['전남광주통합특별시'],
  경북: ['경상북도'],
  경상북도: ['경상북도'],
  경남: ['경상남도'],
  경상남도: ['경상남도'],
  제주: ['제주특별자치도'],
  부산: ['부산광역시'],
  대구: ['대구광역시'],
  대전: ['대전광역시'],
  울산: ['울산광역시'],
  세종: ['세종특별자치시'],
};

/** 직선거리 기반 이동 시간 추정 (분). 길찾기 API를 붙이면 이 함수만 바꾸면 돼요. */
export function estimateMinutes(origin: [number, number], camp: Camp): number | undefined {
  const lat = Number(camp.mapY);
  const lng = Number(camp.mapX);
  if (!lat || !lng) return undefined;
  const R = 6371;
  const dLat = ((lat - origin[0]) * Math.PI) / 180;
  const dLng = ((lng - origin[1]) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((origin[0] * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const km = 2 * R * Math.asin(Math.sqrt(a));
  const roadKm = km * 1.35; // 도로 우회 보정
  return Math.round(10 + (roadKm / 62) * 60); // 주말 평균 시속 62km + 출발 준비 10분
}

const list = (s: string) =>
  String(s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const FLOOR_FIELD: Record<string, keyof Camp> = {
  잔디: 'siteBottomCl1',
  파쇄석: 'siteBottomCl2',
  데크: 'siteBottomCl3',
  자갈: 'siteBottomCl4',
  맨흙: 'siteBottomCl5',
};

/** 조건 하나를 캠핑장 하나에 대해 판정해요. 정보가 없으면 unknown(확인 필요). */
export function evalCond(key: string, camp: Camp, petSize?: PetSize, types: string[] = []): { v: Verdict; text: string } {
  const i = key.indexOf(':');
  const type = i < 0 ? key : key.slice(0, i);
  const arg = i < 0 ? '' : key.slice(i + 1);
  const induty = list(camp.induty);
  const sbrs = list(camp.sbrsCl);
  switch (type) {
    case 'induty': {
      const m = siteMix(camp);
      // 오토캠핑을 찾는데 텐트 사이트 없이 객실만 있으면 업종이 자동차야영장이어도 빼요
      if (arg === '자동차야영장' && m.known && !m.tent) return { v: 'no', text: m.label };
      // 업종은 자동차야영장인데 사이트 수는 오토 0면·일반 텐트만 적힌 곳: 오토인지 확실하지 않아 추정으로 봐요
      if (arg === '자동차야영장' && induty.includes(arg) && m.known && !Number(camp.autoSiteCo || 0) && Number(camp.gnrlSiteCo || 0))
        return { v: 'likely', text: `업종은 오토캠핑장, 사이트는 ${m.label}으로 등록` };
      if (induty.includes(arg)) return { v: 'yes', text: arg };
      // 업종은 "일반야영장"이어도 카라반·글램핑 사이트가 있으면 그 유형으로 인정해요
      if (arg === '카라반' && m.carav) return { v: 'yes', text: `카라반 ${m.carav}동` };
      if (arg === '글램핑' && m.glamp) return { v: 'yes', text: `글램핑 ${m.glamp}동` };
      if (arg === '자동차야영장' && Number(camp.autoSiteCo || 0)) return { v: 'yes', text: `오토 ${camp.autoSiteCo}면` };
      return { v: 'no', text: induty[0] || '-' };
    }
    case 'lct': {
      const lct = list(camp.lctCl);
      if (!lct.length) return { v: 'unknown', text: '정보 없음' };
      return lct.includes(arg) ? { v: 'yes', text: lct.join('·') } : { v: 'no', text: lct.join('·') };
    }
    case 'sbrs': {
      if (!sbrs.length && !induty.length) return { v: 'unknown', text: '정보 없음' };
      const hit = sbrs.includes(arg) || induty.includes(arg) || (arg === '무선인터넷' && induty.includes('유무선인터넷'));
      if (hit) return { v: 'yes', text: '있음' };
      return sbrs.length ? { v: 'no', text: '없음' } : { v: 'unknown', text: '정보 없음' };
    }
    case 'floor': {
      const n = Number(camp[FLOOR_FIELD[arg]] || 0);
      const any = Object.values(FLOOR_FIELD).some((f) => Number(camp[f] || 0) > 0);
      if (n > 0) return { v: 'yes', text: `${n}면` };
      return any ? { v: 'no', text: '없음' } : { v: 'unknown', text: '정보 없음' };
    }
    case 'nopet': {
      // 반려견이 없는 조용한 곳을 원할 때: 반려동물 동반 "불가"인 곳
      const a = camp.animalCmgCl;
      if (!a) return { v: 'unknown', text: '정보 없음' };
      return a === '불가능' ? { v: 'yes', text: '반려동물 동반 불가' } : { v: 'no', text: `반려동물 ${a}` };
    }
    case 'pet': {
      if (camp.kind === 'pension') {
        // 펜션은 반려견 항목이 따로 없어서 소개글로만 봐요
        const no = quote(camp, /(반려|애견|강아지)[^.]{0,12}(불가|금지|안\s*됩|받지\s*않|동반\s*불)/);
        if (no) return { v: 'no', text: no };
        const yes = quote(camp, /(반려견|애견|강아지|반려동물)\s*(동반|입실|가능|전용|운동장|놀이터)/);
        return yes ? { v: 'likely', text: yes } : { v: 'unknown', text: '반려견 정보 없음' };
      }
      const tour = loadPetInfo()[camp.contentId];
      if (tour) return petFromTour(tour, petSize);
      const a = camp.animalCmgCl;
      if (!a) return { v: 'unknown', text: '정보 없음' };
      if (a === '불가능') return { v: 'no', text: '불가' };
      if (a.includes('소형')) {
        if (petSize === 'big') return { v: 'no', text: '소형견만' };
        if (petSize === 'small') return { v: 'yes', text: '소형견 가능' };
        // 5~10kg: 소형견 기준이 캠핑장마다 5kg·7kg·10kg로 달라서 확인이 필요해요
        if (petSize === 'mid') return { v: 'unknown', text: '소형견만 가능 · 몸무게 기준 확인 필요' };
        return { v: 'unknown', text: '소형견만' };
      }
      return { v: 'yes', text: '가능' };
    }
    case 'trailer':
      return camp.trlerAcmpnyAt === 'Y' || camp.caravAcmpnyAt === 'Y'
        ? { v: 'yes', text: '가능' }
        : { v: 'no', text: '불가' };
    case 'online':
      if (!camp.resveCl) return { v: 'unknown', text: '정보 없음' };
      if (!camp.resveCl.includes('온라인')) return { v: 'no', text: camp.resveCl };
      // 온라인 예약으로 등록돼 있어도 예약·홈페이지 링크가 없으면 실제로 어디서 예약하는지 알 수 없어요 (1,757곳 중 256곳)
      if (!toUrl(camp.resveUrl) && !toUrl(camp.homepage)) {
        // "캠핏"처럼 예약처 이름만 적힌 경우도 있어요
        const where = (camp.resveUrl || '').trim();
        return { v: 'unknown', text: where ? `온라인 예약(${where})으로 등록, 링크 없음` : '온라인 예약으로 등록됐지만 예약 링크 없음' };
      }
      return { v: 'yes', text: '온라인 예약 링크 있음' };
    case 'power': {
      // 전력 용량(kW)은 API에 없어요. 전기가 없으면 확실히 불가, 있으면 상세 페이지 확인 필요.
      if (sbrs.length && !sbrs.includes('전기')) return { v: 'no', text: '전기 없음' };
      return { v: 'unknown', text: '확인 필요' };
    }
    case 'toilet':
      return privateToilet(camp, types);
    case 'lend': {
      // 대여 목록이 있는 곳만 판단해요. 목록이 있는데 그 장비가 없으면 "없음", 목록 자체가 없으면 "확인 필요"
      const items = list(camp.eqpmnLendCl || '');
      if (!items.length) return { v: 'unknown', text: '대여 정보 없음' };
      return items.includes(arg) ? { v: 'yes', text: `대여: ${items.join('·')}` } : { v: 'no', text: `대여: ${items.join('·')}` };
    }
    case 'plenty': {
      // 사이트 수 대비 샤워실·개수대·화장실 개수 (사이트 5곳당 1개 이하면 넉넉, 10곳당 1개까지는 보통)
      const field = arg === '샤워실' ? camp.swrmCo : arg === '개수대' ? camp.wtrplCo : camp.toiletCo;
      const cnt = Number(field || 0);
      const m = siteMix(camp);
      const sites = m.tent + m.glamp + m.carav;
      if (!cnt || !sites) return { v: 'unknown', text: '개수 정보 없음' };
      const per = sites / cnt;
      const text = `${arg} ${cnt}개 · 사이트 ${sites}곳 (${per <= 1 ? '사이트마다 1개 이상' : `약 ${Math.round(per)}곳당 1개`})`;
      return per <= 5 ? { v: 'yes', text } : per <= 10 ? { v: 'likely', text } : { v: 'no', text };
    }
    case 'etc': {
      // 기타 부대시설(카페·식당·키즈카페 등). 목록에 없으면 소개글에서 찾아봐요
      const fac = [camp.sbrsEtc, camp.subfacility].filter(Boolean).join(', ');
      if (fac.includes(arg) || (arg === '스파' && /스파|자쿠지|사우나|노천탕|월풀/.test(fac)) || (arg === '수영장' && /풀장|수영장|온수\s*풀/.test(fac))) return { v: 'yes', text: `시설: ${fac.slice(0, 60)}` };
      if (arg === '스파' && camp.saunaYn) return { v: 'yes', text: '사우나 있음 (관광공사)' };
      if (arg === '스파' && camp.rooms?.some((r) => /스파|자쿠지|월풀/.test(r.name || ''))) return { v: 'yes', text: `객실: ${camp.rooms.filter((r) => /스파|자쿠지|월풀/.test(r.name || '')).map((r) => r.name).slice(0, 2).join(', ')}` };
      // 수영장은 "풀장", "온수풀"처럼도 써요. 물놀이장(얕은 물놀이 시설)과는 다른 것으로 봐요
      const q = quote(camp, ETC_WORDS[arg] ?? new RegExp(arg));
      if (q) return { v: 'likely', text: q };
      if (arg === '수영장' && list(camp.sbrsCl).includes('물놀이장')) return { v: 'unknown', text: '물놀이장은 있음 (수영장인지 확인 필요)' };
      return { v: 'unknown', text: '확인 필요' };
    }
    case 'thema': {
      // 테마: 일출·일몰 명소, 단풍, 눈꽃, 봄꽃 (공공데이터 "테마 환경")
      if (list(camp.themaEnvrnCl).includes(arg)) return { v: 'yes', text: arg };
      const q = THEMA_WORDS[arg] && quote(camp, THEMA_WORDS[arg]);
      return q ? { v: 'likely', text: q } : { v: 'unknown', text: '확인 필요' };
    }
    case 'near': {
      // 주변 레저: 낚시, 수상레저, 해수욕, 서핑, 자전거 (공공데이터 "주변 이용 가능 시설"·테마)
      const all = [...new Set([...list(camp.posblFcltyCl), ...list(camp.themaEnvrnCl)])];
      if (all.some((x) => x.includes(arg))) return { v: 'yes', text: `주변: ${all.filter((x) => x.includes(arg)).join('·')}` };
      const q = quote(camp, NEAR_WORDS[arg] ?? new RegExp(arg));
      return q ? { v: 'likely', text: q } : { v: 'unknown', text: '확인 필요' };
    }
    case 'forest':
      if (/휴양림/.test(camp.facltNm) || camp.forest) return { v: 'yes', text: camp.forest ? `${camp.forest.type || ''} 자연휴양림`.trim() : '자연휴양림' };
      return { v: 'no', text: '휴양림 아님' };
    case 'oceanview': {
      const q = quote(camp, /오션\s*뷰|바다\s*(가|이)?\s*(보이|전망|뷰|한눈)|바다\s*조망/);
      if (q) return { v: 'likely', text: q };
      if (list(camp.lctCl).includes('해변')) return { v: 'likely', text: '해변 입지' };
      if (!camp.lctCl) return { v: 'unknown', text: '전망 정보 없음' };
      return { v: 'no', text: list(camp.lctCl).join('·') || '바다 입지 아님' };
    }
    case 'new': {
      // 새로 연 곳: 인허가일이 1년 안이면서, 같은 자리에 예전 인허가가 없고 관광공사 등록도 오래되지 않은 곳.
      // 주인이 바뀌거나 이름을 바꿔 인허가만 새로 받은 곳은 새로 연 곳이 아니에요.
      const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
      const d = camp.license?.permit || camp.permitDate || '';
      const created = (camp.createdtime || '').slice(0, 10);
      if (!d) {
        // 지자체가 운영하는 곳처럼 인허가 기록이 없으면 관광공사 등록일로 봐요
        if (created && created >= yearAgo) return { v: 'likely', text: `관광공사 정보 ${created.slice(0, 7)} 등록` };
        if (created) return { v: 'no', text: `관광공사 등록 ${created.slice(0, 4)}년` };
        return { v: 'unknown', text: '등록일 정보 없음' };
      }
      if (d < yearAgo) return { v: 'no', text: `${d.slice(0, 4)}년 등록` };
      if (camp.firstPermit && camp.firstPermit < yearAgo)
        return { v: 'no', text: `같은 자리에 ${camp.firstPermit.slice(0, 4)}년부터 있던 곳 (인허가만 새로 받음)` };
      if (created && created < yearAgo) return { v: 'no', text: `관광공사 등록 ${created.slice(0, 4)}년 (인허가만 새로 받음)` };
      return { v: 'yes', text: `${d.slice(0, 7)} 등록` };
    }
    case 'tarp': {
      // 설치된 타프·그늘막(타프존). 공공데이터 항목이 없어 소개글로만 알 수 있어요 (약 50곳)
      const q = quote(camp, /타프\s*(가|이|도)?\s*(쳐져|쳐\s*있|설치되|구비|제공)|고정\s*타프|타프\s*존|타프\s*데크|그늘막\s*(이|가|도)?\s*(설치되|제공|있)/);
      return q ? { v: 'likely', text: q } : { v: 'unknown', text: '소개글에 타프 안내 없음' };
    }
    case 'nokids': {
      const q = noKidsQuote(camp);
      return q ? { v: 'likely', text: q } : { v: 'unknown', text: '소개글에 노키즈 안내 없음' };
    }
    case 'program': {
      if (camp.exprnProgrmAt === 'Y') return { v: 'yes', text: camp.exprnProgrm ? `체험: ${camp.exprnProgrm}` : '체험 프로그램 있음' };
      const q = quote(camp, /체험/);
      if (q) return { v: 'likely', text: q };
      return camp.exprnProgrmAt === 'N' ? { v: 'no', text: '체험 프로그램 없음' } : { v: 'unknown', text: '확인 필요' };
    }
    case 'tent': {
      const m = siteMix(camp);
      if (!m.known) return { v: 'unknown', text: '사이트 구성 정보 없음' };
      return m.tent ? { v: 'yes', text: `텐트 사이트 ${m.tent}면` } : { v: 'no', text: m.label };
    }
    case 'brazier': {
      const b = (camp.brazierCl || '').trim();
      if (!b) return { v: 'unknown', text: '정보 없음' };
      if (b === '개별') return { v: 'yes', text: '사이트별 화로대 가능' };
      if (b === '불가') return { v: 'no', text: '화로대 불가' };
      return { v: 'no', text: `${b}에서만` };
    }
    case 'detached': {
      // 독채: 객실 유형에 "독채"가 있거나, 인허가 객실 수가 1개
      if (/독채/.test(camp.roomType || '')) return { v: 'yes', text: `객실 유형: ${camp.roomType}` };
      const q = quote(camp, /독채|단독\s*(건물|주택|사용)|한\s*팀만|1\s*팀\s*전용/);
      if (q) return { v: 'likely', text: q };
      if (camp.roomCount === 1) return { v: 'likely', text: '객실 1개 (인허가)' };
      if (camp.roomCount && camp.roomCount >= 3) return { v: 'no', text: `객실 ${camp.roomCount}개` };
      return { v: 'unknown', text: camp.roomCount ? `객실 ${camp.roomCount}개` : '객실 정보 없음' };
    }
    case 'cook': {
      const c = camp.cookCl || '';
      if (/불가/.test(c)) return { v: 'no', text: `취사 ${c}` };
      if (/가능/.test(c)) return { v: /일부|단,/.test(c) ? 'likely' : 'yes', text: `취사 ${c}` };
      if (camp.rooms?.some((r) => r.cook)) return { v: 'yes', text: '객실 안 취사 시설' };
      const q = quote(camp, /취사\s*(가능|시설)|주방|인덕션|조리\s*도구/);
      return q ? { v: 'likely', text: q } : { v: 'unknown', text: '취사 정보 없음' };
    }
    case 'kidsfriendly': {
      // 키즈 펜션: 이름·객실·부대시설·소개글에 아이 시설이 있는지
      const re = /키즈|아이\s*(전용|놀이)|놀이방|볼풀|미끄럼틀|트램(펄|폴)린|유아/;
      if (re.test(camp.facltNm)) return { v: 'yes', text: `이름: ${camp.facltNm}` };
      if (re.test(camp.subfacility || '')) return { v: 'yes', text: `부대시설: ${camp.subfacility!.slice(0, 40)}` };
      const room = camp.rooms?.find((r) => re.test(r.name || ''));
      if (room) return { v: 'yes', text: `객실: ${room.name}` };
      const q = quote(camp, re);
      return q ? { v: 'likely', text: q } : { v: 'unknown', text: '아이 시설 정보 없음' };
    }
    case 'tourpension':
      return camp.tourPension ? { v: 'yes', text: '관광펜션업 지정' } : { v: 'unknown', text: '관광펜션 지정 기록 없음' };
    case 'capacity': {
      const need = Number(arg) || 0;
      const max = maxPeople(camp);
      if (!max) return { v: 'unknown', text: '객실 인원 정보 없음' };
      return max >= need ? { v: 'yes', text: `최대 ${max}명 객실` } : { v: 'no', text: `가장 큰 객실 ${max}명` };
    }
    case 'price': {
      // arg: "한도:구분" (예: 250000:peakWeekend). 구분이 없으면 날짜를 모르는 것 → 비수기 주중 기준
      const [lim, slotArg] = arg.split(':');
      const limit = Number(lim) || 0;
      const slot = (slotArg as PriceSlot) || 'offWeekday';
      const won = (n: number) => `${(n / 10000).toFixed(n % 10000 ? 1 : 0)}만 원`;
      const p = minPrice(camp, slot);
      if (p) return { v: p <= limit ? 'yes' : 'no', text: `${SLOT_LABEL[slot]} 최저 ${won(p)}${slotArg ? '' : ' (날짜 미정)'}` };
      // 그 구분 가격이 없으면 비수기 주중 가격으로 가늠해요. 비수기 주중부터 한도를 넘으면 다른 때도 넘어요
      const base = minPrice(camp, 'offWeekday');
      if (!base) return { v: 'unknown', text: '가격 정보 없음' };
      if (base > limit) return { v: 'no', text: `비수기 주중부터 ${won(base)}` };
      return { v: 'unknown', text: `비수기 주중 ${won(base)} · ${SLOT_LABEL[slot]} 가격 정보 없음` };
    }
    case 'judge':
      return judge(arg, camp);
    default:
      return { v: 'unknown', text: '확인 필요' };
  }
}

export function seasonOf(month: number): '봄' | '여름' | '가을' | '겨울' {
  if (month >= 3 && month <= 5) return '봄';
  if (month >= 6 && month <= 8) return '여름';
  if (month >= 9 && month <= 11) return '가을';
  return '겨울';
}

// ---------------------------------------------------------------------------
// 판단형 조건: 직접 확인은 못 하지만 고캠핑 데이터에서 근거를 찾아 추정해요.
// ---------------------------------------------------------------------------

const num = (v?: string) => Number(v || 0) || 0;

function siteCount(c: Camp) {
  return num(c.gnrlSiteCo) + num(c.autoSiteCo) + num(c.glampSiteCo) + num(c.caravSiteCo) + num(c.indvdlCaravSiteCo);
}

/** 소개글에서 키워드가 들어간 짧은 구절을 뽑아요 (근거로 보여 주기용) */
function quote(c: Camp, re: RegExp) {
  const text = [c.featureNm, c.lineIntro, c.intro, c.tooltip].filter(Boolean).join(' ').replace(/\s+/g, ' ');
  const m = re.exec(text);
  if (!m) return null;
  // 단어 중간에서 자르지 않도록 앞뒤 공백까지 넓혀요
  let start = Math.max(0, m.index - 12);
  while (start > 0 && text[start - 1] !== ' ') start--;
  let end = Math.min(text.length, m.index + m[0].length + 12);
  while (end < text.length && text[end] !== ' ' && end - m.index < 40) end++;
  return `"${text.slice(start, end).replace(/[,.]$/, '').trim()}"`;
}

/**
 * 개인화장실. 글램핑·카라반은 객실 내부시설 데이터가 있고,
 * 오토캠핑은 "개별 화장실·샤워실이 딸린 사이트"가 소개글에만 적혀 있어서 그 문구로 추정해요.
 * (일부 사이트만이거나 추가 요금인 경우가 있어서 문구는 "확인됨"이 아니라 "추정"이에요)
 */
/**
 * 사이트 구성. 법적으로는 "야영장"이어도 텐트 칠 곳 없이 카라반·글램핑 객실만 있는 곳이 많아요(약 730곳).
 * 사용자 눈에는 펜션에 가까우니 유형을 구성 그대로 보여 주고, 텐트 조건에 써요.
 */
export function siteMix(c: Camp) {
  if (c.kind === 'pension') {
    const rooms = c.roomCount ? `객실 ${c.roomCount}개` : '';
    return { tent: 0, glamp: 0, carav: 0, known: false, roomOnly: false, label: [c.tourPension ? '관광펜션' : c.pensionType || '펜션', rooms].filter(Boolean).join(' · ') };
  }
  const n = (x?: string) => Number(x || 0) || 0;
  const tent = n(c.gnrlSiteCo) + n(c.autoSiteCo);
  const glamp = n(c.glampSiteCo);
  const carav = n(c.caravSiteCo) + n(c.indvdlCaravSiteCo);
  const known = tent + glamp + carav > 0;
  const roomOnly = known && tent === 0;
  const parts = [
    n(c.autoSiteCo) && `오토 ${n(c.autoSiteCo)}면`,
    n(c.gnrlSiteCo) && `텐트 ${n(c.gnrlSiteCo)}면`,
    glamp && `글램핑 ${glamp}동`,
    carav && `카라반 ${carav}동`,
  ].filter(Boolean) as string[];
  const label = !known ? list(c.induty)[0] || '야영장' : roomOnly ? `${parts.join(' · ')}만 (텐트 사이트 없음)` : parts.join(' · ');
  return { tent, glamp, carav, known, roomOnly, label };
}

/** 기타 시설을 소개글에서 찾을 때 쓰는 말 */
const ETC_WORDS: Record<string, RegExp> = {
  수영장: /수영장|풀장|온수\s*풀|인피니티\s*풀/,
  스파: /스파|자쿠지|노천탕|사우나|히노끼|월풀/,
  족구장: /족구/,
  노래방: /노래방|노래\s*연습장/,
  세미나실: /세미나/,
};
const THEMA_WORDS: Record<string, RegExp> = {
  일출명소: /일출|해돋이/,
  일몰명소: /일몰|노을|석양/,
  가을단풍명소: /단풍/,
  겨울눈꽃명소: /눈꽃|설경/,
  봄꽃여행: /벚꽃|봄꽃|철쭉/,
};
const NEAR_WORDS: Record<string, RegExp> = {
  낚시: /낚시/,
  수상레저: /수상\s*레저|카약|패들보드|수상스키|제트스키|바나나보트/,
  해수욕: /해수욕/,
  서핑: /서핑/,
  자전거: /자전거/,
};

/** 노키즈존: 공공데이터에 따로 항목이 없어서 소개글에 적힌 곳만 알 수 있어요 (전체의 1% 미만) */
const NO_KIDS = /노\s*키즈|성인\s*전용\s*(캠핑|글램핑|야영)|14\s*세\s*이상|커플\s*전용\s*(캠핑|글램핑)/;
export function noKidsQuote(c: Camp) {
  return quote(c, NO_KIDS);
}

const PRIVATE_TOILET = /(개별|개인|전용|단독|프라이빗|독립)\s*(샤워실\s*(&|및|과|와|,|·)?\s*)?(화장실|욕실)|화장실\s*(이|가)?\s*(딸린|포함된)\s*(사이트|데크)|(사이트|데크)\s*(별|마다)\s*(개별\s*)?(화장실|욕실)/;
function privateToilet(c: Camp, types: string[]): { v: Verdict; text: string } {
  const room: string[] = [];
  if (/내부화장실/.test(c.glampInnerFclty || '')) room.push('글램핑');
  if (/내부화장실/.test(c.caravInnerFclty || '')) room.push('카라반');
  // 사용자가 유형을 정했으면 그 유형의 객실 화장실만 인정해요 (오토캠핑을 찾는데 글램핑 객실 화장실은 의미 없으니까)
  const roomOk = room.filter((t) => !types.length || types.includes(t));
  if (roomOk.length) return { v: 'yes', text: `${roomOk.join('·')} 객실 안 화장실` };
  const q = quote(c, PRIVATE_TOILET);
  if (q) return { v: 'likely', text: q };
  if (room.length) return { v: 'unknown', text: `${room.join('·')} 객실에만 있음` };
  return { v: 'unknown', text: '확인 필요' };
}

function spacing(c: Camp): { v: Verdict; text: string } {
  const d = num(c.sitedStnc);
  if (d >= 5) return { v: 'yes', text: `사이트 간 ${d}m` };
  if (d >= 3) return { v: 'likely', text: `사이트 간 ${d}m (보통)` };
  if (d > 0) return { v: 'no', text: `사이트 간 ${d}m` };
  const biggest = (c.siteSizes || []).reduce((m, x) => (x.w * x.h > m.w * m.h ? x : m), { w: 0, h: 0, count: 0 });
  if (biggest.w * biggest.h >= 64) return { v: 'likely', text: `사이트 크기 최대 ${biggest.w}×${biggest.h}m` };
  const sites = siteCount(c);
  const area = num(c.allar);
  if (sites && area) {
    const per = Math.round(area / sites);
    if (per >= 300) return { v: 'likely', text: `부지 기준 사이트당 약 ${per}㎡` };
    if (per < 100) return { v: 'no', text: `부지 기준 사이트당 약 ${per}㎡ (빽빽)` };
  }
  const q = quote(c, /(넓은 사이트|사이트 간격|간격이 넓|널찍|여유로운 사이트|프라이빗)/);
  if (q) return { v: 'likely', text: q };
  return { v: 'unknown', text: '정보 없음' };
}

function quiet(c: Camp): { v: Verdict; text: string } {
  const reasons: string[] = [];
  let score = 0;
  if (c.kind === 'pension') {
    if (c.roomCount && c.roomCount <= 3) {
      score++;
      reasons.push(`객실 ${c.roomCount}개 소규모`);
    } else if (c.roomCount && c.roomCount >= 10) {
      score--;
      reasons.push(`객실 ${c.roomCount}개`);
    }
  }
  const sites = siteCount(c);
  if (sites && sites <= 20) {
    score++;
    reasons.push(`${sites}사이트 소규모`);
  } else if (sites >= 80) {
    score--;
    reasons.push(`${sites}사이트 대형`);
  }
  const lct = c.lctCl || '';
  if (/숲|산|계곡/.test(lct) && !/도심/.test(lct)) {
    score++;
    reasons.push(lct.replace(/,/g, '·'));
  }
  if (/도심/.test(lct)) score--;
  const q = quote(c, /(조용|한적|고즈넉|프라이빗|아늑|소음 ?없)/);
  if (q) {
    score++;
    reasons.push(`소개글 ${q}`);
  }
  if (score >= 2) return { v: 'likely', text: reasons.join(', ') };
  if (score < 0) return { v: 'no', text: reasons.join(', ') || '대형·도심' };
  return { v: 'unknown', text: reasons.length ? `근거 부족 (${reasons.join(', ')})` : '근거 없음' };
}

/**
 * 바비큐. 공공데이터에 "바비큐" 항목은 없어서 아래 순서로 근거를 찾아요.
 * 1) 소개글·부대시설 기타에 바비큐·그릴 언급 → 추정(문구 인용)
 * 2) 화로대 "개별" → 사이트에서 숯불·화로를 쓸 수 있어 바비큐 가능성이 높아요 → 추정
 * 3) 화로대 "공동취사장" → 공동 시설에서 가능할 수 있어요 → 추정
 * 4) 화로대 "불가" → 사이트에서 불을 못 피워요 → 아님
 */
function bbq(c: Camp): { v: Verdict; text: string } {
  if (c.kind === 'pension') {
    const own = quote(c, /(개별|객실별|전용|테라스|독립)\s*(바비큐|바베큐|BBQ|그릴)/i);
    if (own) return { v: 'yes', text: own };
    if (/바비큐|바베큐/.test(c.subfacility || '')) return { v: 'yes', text: `부대시설: ${c.subfacility!.slice(0, 40)}` };
    if (c.bbqYn) return { v: 'yes', text: '바비큐 가능 (관광공사)' };
  }
  const q = quote(c, /(바비큐|바베큐|BBQ|그릴|숯불)/i);
  if (q) return { v: 'likely', text: q };
  const etc = c.sbrsEtc || '';
  if (/바비큐|바베큐|BBQ|그릴/i.test(etc)) return { v: 'likely', text: `부대시설: ${etc}` };
  if (c.brazierCl === '개별') return { v: 'likely', text: '화로대 개별 사용 가능 (사이트에서 숯불·그릴 가능성 높음)' };
  if (c.brazierCl === '공동취사장') return { v: 'likely', text: '화로대는 공동취사장에서 사용' };
  if (c.brazierCl === '불가') return { v: 'no', text: '화로대 사용 불가' };
  return { v: 'unknown', text: '바비큐·화로대 정보 없음' };
}

function judge(label: string, c: Camp): { v: Verdict; text: string } {
  if (/간격|넓|널찍|프라이빗/.test(label)) return spacing(c);
  if (/조용|한적|고요|힐링|쉬/.test(label)) return quiet(c);
  if (/바비큐|바베큐|그릴/.test(label)) return bbq(c);
  if (/그늘|나무/.test(label)) {
    const q = quote(c, /(그늘|나무가 많|숲속|소나무|잣나무)/);
    return q ? { v: 'likely', text: q } : { v: 'unknown', text: '소개글에 언급 없음' };
  }
  if (/아이|키즈|어린이/.test(label)) {
    if ((c.sbrsCl || '').includes('놀이터') || (c.sbrsCl || '').includes('물놀이장')) return { v: 'likely', text: '놀이터·물놀이장 있음' };
    const q = quote(c, /(아이|어린이|키즈|가족)/);
    return q ? { v: 'likely', text: q } : { v: 'unknown', text: '소개글에 언급 없음' };
  }
  // 그 밖의 조건은 소개글에 그 단어가 있는지만 봐요
  const word = label.replace(/(있는|좋은|가능한|곳|함|음)$/g, '').trim();
  if (word.length >= 2) {
    const q = quote(c, new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    if (q) return { v: 'likely', text: q };
  }
  return { v: 'unknown', text: '후기 확인 필요' };
}
