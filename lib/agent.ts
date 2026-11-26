import { ORIGINS, PROVINCES, estimateMinutes, evalCond, loadCamps, licenseClosed, loadPetInfo, noKidsQuote, originCoords, siteMix, type Camp } from './data';
import { canCheckLive, checkAvailability, type Availability } from './availability';
import { EXAMPLES } from './examples';
import { kakaoExtras, placeNow } from './kakao';
import { linkAlive, naverSearch, phoneLooksValid, toUrl } from './links';
import { applyPlaces, interpret } from './interpret';
import { parse } from './parse';
import { applyProfile, type Profile } from './profile';
import type { AgentReply, AgentState, Column, DetailCard, Dropped, Places, Relax, Row, Stage } from './types';

function reserveMode(cl: string) {
  if (!cl) return '정보 없음';
  if (cl.includes('온라인실시간예약')) return '온라인 실시간';
  if (cl.includes('온라인예약대기')) return '온라인 예약대기';
  return cl.split(',')[0];
}

const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`);

let regionNames: string[] | null = null;
/** 사용자가 고른 숙소 유형 (글램핑·카라반·오토캠핑) — 개인화장실처럼 유형마다 뜻이 다른 조건에 써요 */
export function typesOf(s: AgentState) {
  return s.conds.filter((c) => c.key.startsWith('induty:')).map((c) => c.key.slice(7));
}

function regions() {
  if (!regionNames) regionNames = [...new Set(loadCamps().camps.map((c) => c.sigunguNm).filter(Boolean))];
  return regionNames;
}

function inRegion(camp: Camp, regs: string[]) {
  return regs.some((r) => camp.sigunguNm === r || (PROVINCES[r] || []).includes(camp.doNm));
}

interface Ctx {
  state: AgentState;
  minutes: Map<string, number | undefined>;
}

/** 조건 묶음으로 후보를 거르고, 단계별 남은 수를 기록해요. */
function pipeline(camps: Camp[], ctx: Ctx, override?: Partial<AgentState>) {
  const s = { ...ctx.state, ...override } as AgentState;
  const stages: Stage[] = [{ label: '전국 등록 캠핑장', count: camps.length }];
  // 단계마다 남은 곳을 기억해 두면, 이전 결과에 있던 곳이 어느 조건에서 빠졌는지 알 수 있어요.
  const sets: { label: string; ids: Set<string> }[] = [];
  const mark = () => sets.push({ label: stages[stages.length - 1].label, ids: new Set(pool.map((c) => c.contentId)) });

  let pool = camps.filter((c) => c.manageSttus !== '휴장');
  const before = pool.length;
  pool = pool.filter((c) => !licenseClosed(c));
  const closedOut = before - pool.length;
  if (s.excludeIds?.length) pool = pool.filter((c) => !s.excludeIds!.includes(c.contentId));
  // 아이와 함께 가면 소개글에 노키즈존이라고 적힌 곳은 빼요
  let noKidsOut = 0;
  if (s.kids && !s.conds.some((c) => c.key === 'nokids')) {
    const before2 = pool.length;
    pool = pool.filter((c) => !noKidsQuote(c));
    noKidsOut = before2 - pool.length;
  }
  if (s.season) pool = pool.filter((c) => !c.operPdCl || c.operPdCl.includes(s.season!));
  stages.push({
    label: s.season ? `운영 중 · ${s.season} 운영` : '운영 중',
    count: pool.length,
    note: [closedOut && `행안부 인허가에 휴업·폐업으로 나온 ${closedOut}곳 제외`, noKidsOut && `아이와 함께라서 노키즈존 ${noKidsOut}곳 제외`].filter(Boolean).join(' · ') || undefined,
  });
  mark();

  const hasArea = s.regions.length > 0 || (s.maxMinutes && s.origin);
  if (hasArea) {
    pool = pool.filter((c) => {
      if (s.regions.length && inRegion(c, s.regions)) return true;
      if (s.maxMinutes && s.origin) {
        const m = ctx.minutes.get(c.contentId);
        return m !== undefined && m <= s.maxMinutes;
      }
      return false;
    });
    const parts = [s.regions.map((r) => r.replace(/(특별자치도|특별시|광역시)$/, '')).join('·'), s.maxMinutes && s.origin ? `${s.origin}에서 ${fmtMin(s.maxMinutes)} 이내` : '']
      .filter(Boolean)
      .join(' 또는 ');
    stages.push({ label: parts, count: pool.length, note: s.maxMinutes && s.origin ? '이동 시간은 직선거리 기반 추정' : undefined });
    mark();
  }

  if (s.pet) {
    pool = pool.filter((c) => evalCond('pet', c, s.petSize, typesOf(s)).v !== 'no');
    stages.push({ label: `${petLabel(s)} 가능`, count: pool.length });
    mark();
  }

  const mustFilters = s.conds.filter((c) => c.must && c.kind === 'filter');
  if (mustFilters.length) {
    pool = pool.filter((c) => mustFilters.every((f) => evalCond(f.key, c, s.petSize, typesOf(s)).v !== 'no'));
    stages.push({ label: mustFilters.map((f) => f.label).join(' · '), count: pool.length });
    mark();
  }

  const mustDetail = s.conds.filter((c) => c.must && c.kind !== 'filter');
  if (mustDetail.length) {
    pool = pool.filter((c) => mustDetail.every((f) => evalCond(f.key, c, s.petSize, typesOf(s)).v !== 'no'));
    const unknown = pool.filter((c) => mustDetail.some((f) => evalCond(f.key, c, s.petSize, typesOf(s)).v === 'unknown')).length;
    stages.push({
      label: `${mustDetail.map((f) => f.label).join(' · ')} (상세 판독)`,
      count: pool.length,
      note: unknown ? `${unknown}곳은 상세 페이지 확인 필요` : undefined,
    });
    mark();
  }
  return { pool, stages, sets };
}

/**
 * 순위 점수. 필수 조건이 확인된 정도가 가장 먼저, 그다음 선호 조건, 마지막에 지역·예약 방식·거리.
 * 필수 조건 하나의 가중치(100)가 나머지 전부를 합친 것보다 커서, 필수가 더 확실한 곳이 항상 앞에 와요.
 */
export function score(c: Camp, s: AgentState, minutes?: number) {
  const musts: { key: string }[] = [...(s.pet ? [{ key: 'pet' }] : []), ...s.conds.filter((x) => x.must)];
  const prefs = s.conds.filter((x) => !x.must);
  let sc = 0;
  for (const m of musts) {
    const v = evalCond(m.key, c, s.petSize, typesOf(s)).v;
    if (v === 'yes') sc += 100;
    else if (v === 'likely') sc += 60;
    // unknown은 0 (no는 이미 걸러져서 여기 오지 않아요)
  }
  for (const p of prefs) {
    const v = evalCond(p.key, c, s.petSize, typesOf(s)).v;
    if (v === 'yes') sc += 10;
    else if (v === 'likely') sc += 6;
    else if (v === 'no') sc -= 6;
  }
  // 유형을 말하지 않았으면 텐트 칠 곳이 있는 "캠핑장"을 객실만 있는 곳(카라반·글램핑만)보다 조금 앞에 둬요
  if (!s.conds.some((x) => x.key.startsWith('induty:') || x.key === 'tent') && siteMix(c).roomOnly) sc -= 3;
  if (s.regions.length && inRegion(c, s.regions)) sc += 4;
  if (c.resveCl.includes('온라인')) sc += 1;
  if (minutes !== undefined) sc -= Math.min(3, minutes / 60);
  return sc;
}

/** 결과 중 빈자리 자동 확인이 되는 곳만 한꺼번에 확인하는 버튼 문구 */
export const LIVE_ALL = '빈자리 확인 가능한 곳만 확인해 줘';
const LIVE_ALL_RE = /빈자리\s*(자동\s*)?(확인|조회)\s*(가능한|되는|할 수 있는)\s*곳/;

/** 지금 결과에서 빈자리 자동 확인이 되는 숙소 번호들 */
function liveRanks(state: AgentState) {
  return (state.lastIds ?? []).map((_, i) => i + 1).filter((n) => {
    const c = campByRank(state, n);
    return c && canCheckLive(c);
  });
}

/** 빈자리 자동 확인이 안 되는 곳의 "N번 빈자리" 버튼은 빼요. 확인 가능한 곳이 없으면 빈자리 버튼 자체를 빼요. */
export function filterChips(chips: string[], state: AgentState) {
  const live = new Set(liveRanks(state));
  return chips.filter((c) => {
    if (!/빈자리/.test(c)) return true;
    const n = c.match(/(\d+)\s*번/);
    if (n) return live.has(Number(n[1]));
    return live.size > 0;
  });
}

/** 확인 가능한 곳 모두 빈자리 확인 (날짜가 없으면 물어봐요) */
async function liveAll(state: AgentState): Promise<AgentReply> {
  const ranks = liveRanks(state);
  if (!ranks.length) {
    return {
      kind: 'message',
      text: '지금 결과에는 빈자리를 자동으로 확인할 수 있는 곳이 없어요. 자동 확인은 캠핑톡 공공 캠핑장만 되고, 나머지는 예약 페이지나 전화로 확인해야 해요.',
      state,
      chips: ['1번 숙소에 문의 메시지 써 줘', '결과 목록 다시 보기'],
      engine: 'agent',
    };
  }
  if (!state.checkIn) {
    state.pendingAvailability = 0;
    return {
      kind: 'ask',
      text: `빈자리를 자동으로 확인할 수 있는 곳은 ${ranks.map((n) => `${n}번`).join(', ')}이에요. 어느 날짜로 볼까요?`,
      state,
      chips: ['이번 주말', '다음주 주말'],
      engine: 'agent',
    };
  }
  const out = (await Promise.all(ranks.slice(0, 5).map((n) => availabilityOf(state, n)))).filter((x) => !!x);
  return {
    kind: 'message',
    text: out.map((a) => a!.text).join('\n'),
    state,
    availabilities: out.map((a) => a!.availability!).filter(Boolean),
    chips: ['결과 목록 다시 보기', ...ranks.slice(0, 2).map((n) => `${n}번 숙소에 문의 메시지 써 줘`)],
    engine: 'agent',
    trace: [{ tool: 'check_availability', label: '빈자리 확인', reason: `자동 확인 가능한 ${ranks.length}곳(${ranks.map((n) => `${n}번`).join(', ')})만 확인` }],
  };
}

function chipsFor(s: AgentState, rows: Row[], relaxCount: number): string[] {
  const chips: string[] = [];
  const live = rows.filter((r) => r.liveCheck);
  if (live.length) chips.push(LIVE_ALL);
  if (rows.length) chips.push('1번 자세히 보기');
  const unknownRow = rows.find((r) => Object.values(r.cells).some((c) => c.v === 'unknown'));
  if (unknownRow) chips.push(`${unknownRow.rank}번 숙소에 문의 메시지 써 줘`);
  if (!s.conds.some((c) => c.key === 'online')) chips.push('온라인 예약 되는 곳만');
  if (!s.conds.some((c) => c.key.startsWith('lct'))) chips.push('계곡 가까운 곳으로');
  if (s.origin && s.maxMinutes && relaxCount === 0) chips.push(`${fmtMin(Math.max(30, s.maxMinutes - 30))} 이내로 좁혀 줘`);
  return chips.slice(0, 5);
}

function petLabel(s: AgentState) {
  if (s.petKg) return `반려견 ${s.petKg}kg 동반`;
  return s.petSize === 'small' ? '소형견 동반' : s.petSize === 'mid' ? '반려견(5~10kg) 동반' : s.petSize === 'big' ? '중·대형견 동반' : '반려견 동반';
}

function describe(s: AgentState) {
  const u: AgentReply['understood'] = [];
  if (s.dateLabel) u.push({ label: `${s.dateLabel}${s.season ? ` · ${s.season}` : ''}`, tone: 'info' });
  if (s.people) u.push({ label: `${s.people}명`, tone: 'info' });
  if (s.pet) u.push({ label: petLabel(s), tone: 'must' });
  if (s.regions.length) u.push({ label: s.regions.map((r) => r.replace(/(특별자치도|특별시|광역시)$/, '')).join('·'), tone: 'pref' });
  if (s.origin && s.maxMinutes) u.push({ label: `${s.origin}에서 ${fmtMin(s.maxMinutes)} 이내`, tone: 'must' });
  const hasPower = s.conds.some((c) => c.key.startsWith('power'));
  for (const c of s.conds) if (!(hasPower && c.key === 'sbrs:전기')) u.push({ label: c.label, tone: c.must ? 'must' : 'pref', profile: c.fromProfile && !c.must });
  return u;
}

export function originChips(places?: Places) {
  return [places?.home ? '우리 집에서 출발' : '우리 집 주소 등록하기', '현재 위치에서 출발', '서울에서 출발', '성남에서 출발', '수원에서 출발'];
}

export { describe };

// ---------------------------------------------------------------------------
// 도구로도 쓰는 기능들 (Gemini 에이전트 루프와 기본 파이프라인이 함께 써요)
// ---------------------------------------------------------------------------

export function campByRank(state: AgentState, index: number) {
  const id = state.lastIds?.[index - 1];
  return loadCamps().camps.find((c) => c.contentId === id);
}

/** 고캠핑 갱신일. 1년이 넘으면 예약 링크·이름이 바뀌었을 수 있어서 표시해요. */
function freshness(c: Camp) {
  const m = /^(\d{4})-(\d{2})/.exec(c.modifiedtime || '');
  if (!m || c.source) return {};
  const months = (new Date().getFullYear() - Number(m[1])) * 12 + (new Date().getMonth() + 1 - Number(m[2]));
  return { asOf: `${m[1]}-${m[2]}`, stale: months > 12 };
}

/** 공공데이터(관광공사) 캠핑장 사진 목록. 상세 보기 때만 부르고 하루 캐시해요. */
const imageCache = new Map<string, { at: number; urls: string[] }>();
async function campImages(c: Camp): Promise<string[]> {
  const key = process.env.GOCAMPING_SERVICE_KEY;
  if (!key || c.source) return [];
  const hit = imageCache.get(c.contentId);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.urls;
  try {
    const u = new URL('https://apis.data.go.kr/B551011/GoCamping/imageList');
    u.search = new URLSearchParams({ serviceKey: key, MobileOS: 'ETC', MobileApp: 'StayScout', _type: 'json', contentId: c.contentId, numOfRows: '20', pageNo: '1' }).toString();
    const r = await fetch(u, { signal: AbortSignal.timeout(5000) });
    const it = (await r.json())?.response?.body?.items?.item ?? [];
    const urls = (Array.isArray(it) ? it : [it]).map((x: { imageUrl?: string }) => x.imageUrl).filter((x: unknown): x is string => typeof x === 'string' && x.startsWith('http'));
    imageCache.set(c.contentId, { at: Date.now(), urls });
    return urls;
  } catch {
    return [];
  }
}

/** 상위 몇 곳을 카카오맵과 맞춰 지금 이름·전화를 붙여요. 실패하면 그대로 둬요. */
export async function attachPlaces(rows: Row[], n = 5) {
  const camps = loadCamps().camps;
  await Promise.all(
    rows.slice(0, n).map(async (r) => {
      const c = camps.find((x) => x.contentId === r.id);
      const [p, alive] = await Promise.all([c ? placeNow(c) : null, linkAlive(r.reserve.url)]);
      if (p) r.place = p;
      if (alive === false) r.reserve.dead = true;
    })
  );
  return rows;
}

/** 상세 보기에 카카오맵 지금 정보를 더해요. */
export async function detailWithPlace(state: AgentState, index: number) {
  const d = detailOf(state, index);
  const camp = campByRank(state, index);
  if (!d || !camp) return d;
  const [p, alive, images] = await Promise.all([
    placeNow(camp),
    Promise.all(d.detail.links.map((l) => (/gocamping|kakao/.test(l.url) ? Promise.resolve(true) : linkAlive(l.url)))),
    campImages(camp),
  ]);
  if (images.length) d.detail.images = [...new Set([camp.firstImageUrl, ...images].filter((x): x is string => !!x))].slice(0, 12);
  const dead = d.detail.links.filter((_, i) => alive[i] === false);
  for (const l of dead) l.label += ' (열리지 않음)';
  const f = freshness(camp);
  const facts = d.detail.facts;
  const notes: string[] = [];
  if (dead.length) notes.push(`${dead.map((l) => l.label.replace(' (열리지 않음)', '')).join('·')} 주소가 지금 열리지 않아요(도메인이 없거나 서버가 응답하지 않음).`);
  if (camp.tel && !phoneLooksValid(camp.tel)) {
    const t = facts.find((x) => x.label === '전화');
    if (t) t.value = `${camp.tel} (자릿수가 맞지 않아요. 잘못 등록된 번호 같아요)`;
    notes.push('등록된 전화번호도 자릿수가 맞지 않아요.');
  }
  if (!p) {
    facts.push({ label: '카카오맵', value: '같은 위치에 등록된 장소를 찾지 못했어요' });
    if (dead.length) notes.push('카카오맵에도 등록돼 있지 않아서, 네이버 검색으로 지금 연락처를 찾아보는 게 좋겠어요.');
  }
  d.detail.links.push({ label: '네이버에서 검색', url: naverSearch(`${camp.facltNm} ${camp.sigunguNm}`) });
  if (notes.length) d.text += ' ' + notes.join(' ');
  if (f.asOf) facts.push({ label: '정보 기준', value: `${f.asOf} 갱신된 공공 정보${f.stale ? ' · 1년 넘게 갱신 안 됨, 예약처가 바뀌었을 수 있어요' : ''}` });
  if (p) {
    facts.push({ label: '카카오맵', value: `${p.name}${p.phone ? ` · ${p.phone}` : ''}${p.renamed ? ' (지금은 이 이름으로 운영 중인 것 같아요)' : ''}` });
    // 이름으로 찾는 카카오맵 링크가 이미 있으면 같은 자리의 장소 링크로 바꿔요 (버튼이 두 번 나오지 않게)
    const k = d.detail.links.findIndex((l) => l.label === '카카오맵에서 보기');
    if (k >= 0) d.detail.links[k] = { label: '카카오맵에서 보기', url: p.url };
    else d.detail.links.push({ label: '카카오맵에서 보기', url: p.url });
    if (p.renamed) d.text += ` 카카오맵에는 같은 위치에 "${p.name}"(으)로 나와요. 이름이 바뀌었을 수 있으니 예약 전에 ${p.phone ? `${p.phone}로 ` : ''}확인해 보세요.`;
  }
  return d;
}

export function detailOf(state: AgentState, index: number): { text: string; detail: DetailCard; chips: string[] } | null {
  const camp = campByRank(state, index);
  if (!camp) return null;
  return {
    text: `${index}번 ${camp.facltNm} 정보예요. 한국관광공사·행정안전부 공공데이터를 모아서 보여 드려요.`,
    detail: {
      id: camp.contentId,
      name: camp.facltNm,
      intro: camp.lineIntro,
      address: camp.addr1,
      image: camp.firstImageUrl || undefined,
      facts: [
        { label: '유형', value: `${siteMix(camp).label} (${camp.induty.split(',')[0]})` },
        { label: '입지', value: camp.lctCl || '-' },
        { label: '부대시설', value: camp.sbrsCl || '-' },
        { label: '반려동물', value: camp.animalCmgCl || '-' },
        ...(() => {
          const p = loadPetInfo()[camp.contentId];
          if (!p) return [];
          return [
            { label: '동반 조건', value: [p.allowed, p.type, p.need].filter(Boolean).join(' · ') || '-' },
            ...(p.etc ? [{ label: '동반 안내', value: p.etc.length > 160 ? `${p.etc.slice(0, 160)}…` : p.etc }] : []),
          ];
        })(),
        { label: '운영 기간', value: [camp.operPdCl, camp.operDeCl].filter(Boolean).join(' · ') || '-' },
        { label: '예약 방식', value: camp.resveCl || '-' },
        ...(camp.siteSizes?.length
          ? [{ label: '사이트 크기', value: camp.siteSizes.map((x) => `${x.w}×${x.h}m ${x.count}개`).join(', ') }]
          : []),
        ...(camp.license
          ? [{ label: '인허가', value: `${camp.license.status}${camp.license.permit ? ` · ${camp.license.permit} 등록` : ''} (행정안전부 일반야영장업)` }]
          : []),
        ...(camp.forest
          ? [
              { label: '휴양림 입장료', value: camp.forest.fee || '-' },
              { label: '휴양림 시설', value: `${camp.forest.facilities.replace(/\+/g, ', ')}${camp.forest.capacity ? ` · 수용 ${camp.forest.capacity}명` : ''}` },
            ]
          : []),
        ...(camp.source ? [{ label: '출처', value: `${camp.source}${camp.permitDate ? ` (인허가 ${camp.permitDate})` : ''} · 기본 정보만 있는 곳` }] : []),
        { label: '전화', value: camp.tel || '-' },
      ],
      links: [
        toUrl(camp.resveUrl) && { label: '예약 페이지', url: toUrl(camp.resveUrl) },
        toUrl(camp.homepage) && toUrl(camp.homepage) !== toUrl(camp.resveUrl) && { label: '홈페이지', url: toUrl(camp.homepage) },
        camp.source
          ? { label: '카카오맵에서 보기', url: `https://map.kakao.com/?q=${encodeURIComponent(`${camp.facltNm} ${camp.sigunguNm}`)}` }
          : { label: '관광공사 캠핑장 정보', url: `https://gocamping.or.kr/bsite/camp/info/read.do?c_no=${camp.contentId}` },
      ].filter(Boolean) as { label: string; url: string }[],
    },
    chips: [...(canCheckLive(camp) ? [`${index}번 빈자리 확인해 줘`] : []), `${index}번 숙소에 문의 메시지 써 줘`, '결과 목록 다시 보기'],
  };
}

export function draftOf(state: AgentState, index: number) {
  const camp = campByRank(state, index);
  if (!camp) return null;
  const unknowns = state.conds.filter((c) => evalCond(c.key, camp, state.petSize, typesOf(state)).v === 'unknown').map((c) => c.label);
  if (state.pet && evalCond('pet', camp, state.petSize, typesOf(state)).v === 'unknown') unknowns.push('반려견 크기 제한');
  const asks = unknowns.length ? unknowns : ['예약 가능 여부'];
  const who = [state.dateLabel, state.people ? `${state.people}명` : '', state.pet ? '반려견 1마리 동반' : ''].filter(Boolean).join(', ');
  const line = (a: string) =>
    a.startsWith('전력') ? `- ${a.replace(' 이상', '')} 이상 쓸 수 있는 사이트가 있는지` : a.endsWith('여부') ? `- ${a}` : `- ${a} 여부`;
  const draft = [
    `안녕하세요, ${camp.facltNm} 예약 문의드립니다.`,
    who ? `${who} 일정으로 이용하려고 하는데요,` : '이용하려고 하는데 몇 가지 여쭤봐도 될까요?',
    ...asks.map(line),
    '확인 부탁드립니다. 감사합니다.',
  ].join('\n');
  return {
    name: camp.facltNm,
    tel: camp.tel,
    asks,
    draft,
    text: `${camp.facltNm}에 보낼 문의 메시지를 써 봤어요. 확인이 필요한 항목(${asks.join(', ')})만 물어봐요. ${camp.tel ? `전화번호는 ${camp.tel}이에요.` : ''} 실제 전송은 승인 후에 하도록 만들 예정이에요.`,
    chips: ['결과 목록 다시 보기', '1번 자세히 보기'],
  };
}

/** N번 숙소의 빈자리를 확인해요. 날짜가 없으면 null(되물어야 함). */
export async function availabilityOf(state: AgentState, index: number): Promise<{ text: string; availability?: Availability; chips: string[]; needDate?: boolean } | null> {
  const camp = campByRank(state, index);
  if (!camp) return null;
  if (!state.checkIn) {
    state.pendingAvailability = index; // 다음 답이 날짜면 검색이 아니라 이 숙소 빈자리 확인으로 이어가요
    return { text: `${index}번 ${camp.facltNm}, 어느 날짜의 빈자리를 볼까요?`, chips: ['이번 주말', '다음주 주말'], needDate: true };
  }
  state.pendingAvailability = undefined;
  const a = await checkAvailability(camp, state.checkIn, state.nights ?? 1, state.people, state.dateLabel ?? state.checkIn);
  if (a.status === 'ok') {
    const open = a.zones.filter((z) => z.left > 0);
    const text = open.length
      ? `${a.camp}, ${a.dateLabel}에 ${open.map((z) => `${z.name} ${z.left}자리`).join(', ')} 남아 있어요. (${a.platform} 기준, ${a.checkedAt} 확인)`
      : `${a.camp}${(() => { const c = a.camp.charCodeAt(a.camp.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '은' : '는'; })()} ${a.dateLabel}에 남은 자리가 없어요. (${a.platform} 기준, ${a.checkedAt} 확인)`;
    return { text, availability: a, chips: open.length ? [`${index}번 숙소에 문의 메시지 써 줘`, '결과 목록 다시 보기'] : ['다음주 주말로 바꿔 줘', '결과 목록 다시 보기'] };
  }
  return {
    text: a.reason + (a.url ? ' 예약 페이지에서 직접 확인해 주세요.' : ''),
    availability: a,
    chips: [`${index}번 숙소에 문의 메시지 써 줘`, '결과 목록 다시 보기'],
  };
}

/** 결과를 바꾸는 정보가 빠졌으면 되물을 내용을 돌려줘요. */
export function missingInfo(state: AgentState, needHome: boolean, places?: Places): { text: string; chips: string[] } | null {
  if (needHome && !state.originCoords) {
    return {
      text: '아직 집 주소를 몰라요. 한 번 등록해 두면 다음부터는 "우리 집에서 2시간"이라고만 해도 알아들어요. 지금은 다른 출발지로 찾을 수도 있어요.',
      chips: originChips(places),
    };
  }
  if (state.maxMinutes && !state.origin) {
    return { text: `이동 시간 ${fmtMin(state.maxMinutes)} 이내로 찾으려면 출발지가 필요해요. 어디에서 출발하세요?`, chips: originChips(places) };
  }
  if (state.pet && !state.petSize) {
    return {
      text: '강아지 크기에 따라 갈 수 있는 곳이 크게 달라져요. 소형견만 받는 캠핑장이 많거든요. 강아지는 어느 정도 크기예요?',
      chips: ['5kg 이하 소형견', '5~10kg', '10kg 넘는 중·대형견'],
    };
  }
  if (!state.regions.length && !(state.origin && state.maxMinutes) && !state.conds.length) {
    return { text: '어느 쪽으로 가고 싶으세요? 지역을 말하거나, 출발지와 이동 시간을 알려 주셔도 돼요.', chips: ['포천', '가평', '강원도 바다 쪽', '서울에서 2시간 이내'] };
  }
  return null;
}

function minutesFor(state: AgentState) {
  const minutes = new Map<string, number | undefined>();
  const origin = state.originCoords ?? originCoords(state.origin);
  if (origin) for (const c of loadCamps().camps) minutes.set(c.contentId, estimateMinutes(origin, c));
  return minutes;
}

/** 현재 조건으로 탐색해서 단계별 수, 결과 표, 상위 10곳을 만들어요. state.lastIds를 갱신해요. */
export function searchOf(state: AgentState) {
  const { camps } = loadCamps();
  const minutes = minutesFor(state);
  const { pool, stages, sets } = pipeline(camps, { state, minutes });
  const all = pool.map((c) => ({ c, s: score(c, state, minutes.get(c.contentId)) })).sort((a, b) => b.s - a.s);
  const ranked = all.slice(0, 10);
  const prevIds = state.lastIds ?? [];

  const columns: Column[] = [];
  if (state.pet) columns.push({ key: 'pet', label: '반려견', kind: 'filter', must: true });
  const hasPower = state.conds.some((c) => c.key.startsWith('power'));
  for (const c of state.conds) if (!(hasPower && c.key === 'sbrs:전기')) columns.push({ key: c.key, label: c.label, kind: c.kind, must: c.must, fromProfile: c.fromProfile && !c.must });

  const rows: Row[] = ranked.map(({ c }, i) => ({
    id: c.contentId,
    rank: i + 1,
    name: c.facltNm,
    area: `${c.doNm.replace(/(특별자치도|특별시|광역시|도)$/, '')} ${c.sigunguNm}`,
    type: siteMix(c).label,
    minutes: minutes.get(c.contentId),
    inRegion: state.regions.length ? inRegion(c, state.regions) : false,
    cells: Object.fromEntries(columns.map((col) => [col.key, evalCond(col.key, c, state.petSize, typesOf(state))])),
    reserve: { mode: reserveMode(c.resveCl), url: toUrl(c.resveUrl) || toUrl(c.homepage) },
    liveCheck: canCheckLive(c),
    extraSource: c.source,
    ...freshness(c),
    image: c.firstImageUrl || undefined,
  }));
  state.lastIds = rows.map((r) => r.id);
  const unknownCount = rows.filter((r) => Object.values(r.cells).some((c) => c.v === 'unknown')).length;

  // 이전 결과(상위 10곳)에 있었는데 이번에 빠진 곳과 그 이유
  const now = new Set(state.lastIds);
  const dropped: Dropped[] = prevIds
    .filter((id) => !now.has(id))
    .map((id) => {
      const c = camps.find((x) => x.contentId === id);
      if (!c) return null;
      const out = sets.find((st) => !st.ids.has(id));
      if (out) {
        // 어느 조건 때문인지 콕 집어요 (여러 조건을 묶은 단계라도)
        const musts = [...(state.pet ? [{ key: 'pet', label: '반려견 동반' }] : []), ...state.conds.filter((x) => x.must)];
        const fail = musts.filter((m) => evalCond(m.key, c, state.petSize, typesOf(state)).v === 'no').map((m) => m.label);
        const why = fail.length ? `${fail.join(' · ')} 조건이 맞지 않아요` : `${out.label} 조건에서 빠졌어요`;
        return { id, name: c.facltNm, reason: why };
      }
      const r = all.findIndex((x) => x.c.contentId === id);
      return { id, name: c.facltNm, reason: r >= 0 ? `조건은 맞지만 순위가 밀렸어요 (${r + 1}위)` : '이번 조건에서 빠졌어요' };
    })
    .filter((x): x is Dropped => !!x);
  // 필수 조건이 모두 확인됐거나 근거로 추정되는 곳 (나머지는 "확인 필요"가 섞인 후보)
  const musts = [...(state.pet ? ['pet'] : []), ...state.conds.filter((x) => x.must).map((x) => x.key)];
  const mustOk = pool.filter((c) => musts.every((k) => evalCond(k, c, state.petSize, typesOf(state)).v !== 'unknown')).length;
  return { total: pool.length, stages, columns, rows, unknownCount, dropped, mustOk };
}

/** 고캠핑에 없는 같은 지역 캠핑장 (카카오 장소 검색) */
export function extrasFor(state: AgentState) {
  return kakaoExtras(state, state.originCoords ?? originCoords(state.origin));
}

/** 어떤 조건을 풀면 몇 곳이 늘어나는지 계산해요. */
export function relaxOf(state: AgentState): Relax[] {
  const { camps } = loadCamps();
  const minutes = minutesFor(state);
  const ctx: Ctx = { state, minutes };
  const base = pipeline(camps, ctx).pool.length;
  const relax: Relax[] = [];
  for (const cond of state.conds.filter((c) => c.must)) {
    const n = pipeline(camps, ctx, { conds: state.conds.filter((c) => c !== cond) }).pool.length;
    if (n > base) relax.push({ label: `${cond.label} 조건 빼고 찾아 줘`, gain: n - base });
  }
  if (state.origin && state.maxMinutes) {
    const more = state.maxMinutes + 30;
    const n = pipeline(camps, ctx, { maxMinutes: more }).pool.length;
    if (n > base) relax.push({ label: `${fmtMin(more)} 이내까지 넓혀 줘`, gain: n - base });
  }
  if (state.pet && state.petSize === 'small') {
    // 소형견은 이미 가장 넓은 조건이라 제안하지 않아요.
  }
  if (state.regions.length && !(state.origin && state.maxMinutes)) {
    const seoul = new Map<string, number | undefined>();
    for (const c of camps) seoul.set(c.contentId, estimateMinutes(ORIGINS['서울'], c));
    const n = pipeline(camps, { state, minutes: seoul }, { origin: '서울', maxMinutes: 120 }).pool.length;
    if (n > base) relax.push({ label: '서울에서 2시간 이내로 넓혀 줘', gain: n - base });
  }
  return relax.sort((a, b) => b.gain - a.gain).slice(0, 4);
}

/** 판단형 조건을 추정했으면, 무엇으로 추정했는지 한 줄 덧붙여요 */
export function estimateNote(state: AgentState, rows: Row[], text: string) {
  const judged = state.conds.filter((c) => c.kind === 'judge' && rows.some((r) => r.cells[c.key]?.v === 'likely'));
  if (!judged.length || text.includes('추정')) return text;
  const names = judged.map((c) => c.label).join('·');
  const last = names.charCodeAt(names.length - 1);
  const josa = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 ? '은' : '는';
  return `${text}\n${names}${josa} 사이트 정보와 소개글로 추정했어요.`;
}

export function resultText(total: number, shown: number, unknownCount: number, mustOk = total) {
  if (!total) return '조건을 모두 만족하는 곳을 찾지 못했어요. 어떤 조건을 풀면 몇 곳이 나오는지 계산해 봤어요.';
  if (total < 3) return `조건에 맞는 곳이 ${total}곳뿐이에요. 조건을 조금 풀면 선택지가 늘어나요.`;
  if (mustOk < total) {
    const head = `후보 ${total.toLocaleString()}곳 중 필수 조건이 확인(또는 추정)된 곳은 ${mustOk.toLocaleString()}곳이에요.`;
    if (!mustOk) return `후보 ${total.toLocaleString()}곳 중 필수 조건이 확인된 곳은 없어요. 표의 ${shown}곳은 모두 "확인 필요"라서 예약 전에 문의해 봐야 해요.`;
    return mustOk >= shown
      ? `${head} 그중 잘 맞는 순서로 ${shown}곳을 골랐어요.`
      : `${head} 표에는 그 ${mustOk}곳을 먼저 두고, 나머지 ${shown - mustOk}곳은 "확인 필요"인 곳이에요.`;
  }
  return `조건에 맞는 ${total.toLocaleString()}곳 중 잘 맞는 ${shown}곳을 골랐어요.${unknownCount ? ` ${unknownCount}곳은 "확인 필요" 조건이 있어요.` : ''}`;
}

export { chipsFor };

// ---------------------------------------------------------------------------
// 진입점: Gemini 에이전트 루프 → 실패하면 기본 파이프라인
// ---------------------------------------------------------------------------

export async function runAgent(text: string, prevIn: AgentState, places?: Places, profile?: Profile): Promise<AgentReply> {
  const reply = await runAgentInner(text, applyProfile(prevIn, profile), places);
  // 상세를 보여 줬으면 그곳을 "지금 이야기 중인 캠핑장"으로 기억하고, 새 검색 결과가 나오면 잊어요
  if (reply.detail) reply.state = { ...reply.state, focusId: reply.detail.id };
  else if (reply.kind === 'result' && reply.state.focusId) reply.state = { ...reply.state, focusId: undefined };
  let chips = filterChips(reply.chips, reply.state);
  // 결과에 자동 확인 가능한 곳이 있으면 "확인 가능한 곳만 빈자리 확인" 버튼을 맨 앞에 둬요
  if (reply.rows?.some((r) => r.liveCheck) && !chips.includes(LIVE_ALL)) {
    chips = [LIVE_ALL, ...chips.filter((c) => !/빈자리/.test(c))].slice(0, 5);
  }
  // 같이 둘 수 없는 조건이 함께 들어오면 짚어 줘요 (반려견과 함께 + 반려동물 없는 곳)
  if (reply.kind === 'result' && reply.state.pet && reply.state.conds.some((c) => c.key === 'nopet')) {
    return {
      ...reply,
      text: `반려견과 함께 간다고 하셨는데 "반려동물 없는 곳" 조건도 있어요. 그런 곳은 반려견 입장이 안 돼요.\n${reply.text}`,
      chips: ['반려동물 없는 곳 조건 빼고', ...chips].slice(0, 5),
    };
  }
  // 같이 둘 수 없는 조건이 함께 들어오면 짚어 줘요 (아이와 함께 + 노키즈존)
  if (reply.kind === 'result' && reply.state.kids && reply.state.conds.some((c) => c.key === 'nokids')) {
    return {
      ...reply,
      text: `아이와 함께 간다고 하셨는데 노키즈존 조건도 있어요. 노키즈존은 아이 입장이 안 될 수 있으니 확인해 주세요.\n${reply.text}`,
      chips: ['노키즈존 조건 빼고', ...chips].slice(0, 5),
    };
  }
  return { ...reply, chips };
}

// 버튼이 보내는 고정 문장만 코드로 바로 처리해요. 사람이 직접 쓴 말은 모두 에이전트(Gemini)가 판단해요.
const DETAIL_RE = /^(\d+)번 자세히 보기$/;

// 상세의 "비슷한 곳 찾기" 버튼이 보내는 문장: "이름 (시군)과 비슷한 곳 찾아줘"
const SIMILAR_RE = /^(.+ \([^)]+\))(?:과|와) 비슷한 곳 찾아줘$/;

const norm = (x: string) => x.replace(/\(주\)|주식회사/g, '').toLowerCase().replace(/[\s&·.,()\[\]'"!?~\-_/]/g, '');

/** 이름으로 캠핑장 찾기 (띄어쓰기·기호 무시). 정확히 같은 이름이 있으면 그것만, 없으면 이름에 포함되는 곳들 */
export function lookupCampsByName(name: string, area?: string): Camp[] {
  const target = norm(name.replace(/\(([^)]+)\)/, ''));
  area = area || name.match(/\(([^)]+)\)/)?.[1]?.trim();
  if (target.length < 3) return [];
  const camps = loadCamps().camps.filter((c) => !licenseClosed(c) && (!area || c.sigunguNm === area || c.sigunguNm.startsWith(area)));
  const exact = camps.filter((c) => norm(c.facltNm) === target);
  if (exact.length) return exact;
  // "캠핑장·야영장·글램핑" 같은 꼬리말은 빼고 이름 핵심끼리 비교해요.
  // (예: "다올숲 캠핑장" → 다올숲. 꼬리말만 겹치는 "숲캠핑장"이 걸리지 않게)
  const t = core(target);
  if (t.length < 2) return [];
  const same = camps.filter((c) => core(norm(c.facltNm)) === t);
  if (same.length) return same;
  const within = camps.filter((c) => core(norm(c.facltNm)).includes(t));
  if (within.length) return within;
  // 사용자가 이름 뒤에 다른 말을 붙였을 때 (예: "하조대캠핑카예약")
  return camps.filter((c) => {
    const n = core(norm(c.facltNm));
    return n.length >= 3 && t.startsWith(n);
  });
}
const core = (n: string) => n.replace(/(오토캠핑장|캠핑장|캠핑|야영장|글램핑장|글램핑|캠프|캠핑파크)$/, '');

async function runAgentInner(text: string, prevIn: AgentState, places?: Places): Promise<AgentReply> {
  // 직전에 "어느 날짜 빈자리?"를 물었고 이번 답에 날짜가 있으면, 새 검색이 아니라 그 빈자리 확인을 이어가요.
  // (pendingAvailability: 숙소 번호, 0이면 확인 가능한 곳 전부)
  const pending = prevIn.pendingAvailability;
  const prev: AgentState = { ...prevIn, pendingAvailability: undefined };
  if (pending !== undefined) {
    const p = parse(text, prev, regions());
    const onlyDate = p.state.checkIn && !p.commands.length && p.state.conds.length === prev.conds.length && p.state.regions.length === prev.regions.length;
    if (onlyDate) {
      const state: AgentState = { ...prev, checkIn: p.state.checkIn, nights: p.state.nights ?? 1, dateLabel: p.state.dateLabel, season: p.state.season };
      if (pending === 0) return liveAll(state);
      const a = await availabilityOf(state, pending);
      if (a) {
        return {
          kind: 'message',
          text: a.text,
          state,
          availability: a.availability,
          chips: a.chips,
          engine: 'agent',
          trace: [{ tool: 'check_availability', label: '빈자리 확인', reason: `앞에서 물어본 날짜(${state.dateLabel ?? state.checkIn})로 ${pending}번 빈자리를 이어서 확인` }],
        };
      }
    }
  }
  // "빈자리 확인 가능한 곳만 확인해 줘" (날짜가 같이 오면 그 날짜로)
  if (LIVE_ALL_RE.test(text) && prev.lastIds?.length) {
    const p = parse(text, prev, regions());
    return liveAll({ ...prev, ...(p.state.checkIn ? { checkIn: p.state.checkIn, nights: p.state.nights ?? 1, dateLabel: p.state.dateLabel, season: p.state.season } : {}) });
  }
  // 결과 표의 행·버튼으로 들어온 "N번 자세히 보기"는 Gemini를 거치지 않고 바로 상세를 열어요.
  // 상세 화면은 원래 데이터로 만들기 때문에 결과는 같고, 빠르고 무료 한도도 아껴요. 자유 질문("1번 화장실은 어때?")은 에이전트가 처리해요.
  const quick = DETAIL_RE.exec(text);
  if (quick && prev.lastIds?.length) {
    const n = Number(quick[1]);
    const d = await detailWithPlace(prev, n);
    if (d)
      return {
        kind: 'detail',
        text: d.text,
        state: prev,
        detail: d.detail,
        chips: d.chips,
        engine: 'agent',
        trace: [{ tool: 'get_camp_detail', label: '상세 정보', reason: `${n}번 상세 보기를 눌러서 바로 열었어요` }],
      };
  }
  // "다올숲과 비슷한 곳 찾아줘": 기준 캠핑장 특징으로 조건을 만들어 근처에서 찾아요
  const sim = SIMILAR_RE.exec(text);
  if (sim) {
    const found = lookupCampsByName(sim[1]);
    if (found.length === 1) {
      const camp = found[0];
      const { state, basis } = similarState(camp, prev);
      const lead = `${camp.facltNm}${josaWa(camp.facltNm)} 비슷한 곳을 ${camp.facltNm} 기준 1시간 이내에서 찾았어요. 기준: ${basis.join(' · ') || '위치'}. `;
      const reply = await searchReply(state, lead);
      return { ...reply, engine: 'agent', trace: [{ tool: 'find_similar', label: '비슷한 곳 찾기', reason: `${camp.facltNm}의 특징(${basis.join(', ')})으로 근처를 찾았어요` }] };
    }
    if (found.length > 1 && found.length <= 6)
      return {
        kind: 'message',
        text: `이름이 비슷한 곳이 ${found.length}곳 있어요. 어느 곳과 비슷한 곳을 찾을까요?`,
        state: prev,
        chips: found.map((c) => `${c.facltNm} (${c.sigunguNm})${josaWa(c.facltNm)} 비슷한 곳 찾아줘`),
        engine: 'agent',
      };
  }
  const { runAgentLoop } = await import('./agent-loop');
  const looped = await runAgentLoop(text, prev, places);
  if (looped) return looped;
  return runPipeline(text, prev, places);
}

/** 기본 파이프라인: 정해진 순서로 해석 → 되묻기 → 탐색 → 조건 완화 */
export async function runPipeline(text: string, prev: AgentState, places?: Places): Promise<AgentReply> {
  const { state, commands, engine } = await interpret(text, prev, regions(), (n) => !!originCoords(n));
  const needHome = applyPlaces(text, state, places);
  const done = (r: AgentReply): AgentReply => ({ ...r, engine });

  for (const cmd of commands) {
    if (cmd.type === 'reset') {
      return done({ kind: 'message', text: '좋아요, 처음부터 다시 찾을게요. 원하는 조건을 편하게 말해 주세요.', state, chips: EXAMPLES });
    }
    if (cmd.type === 'availability') {
      const a = await availabilityOf(state, cmd.index);
      if (a) return done({ kind: a.needDate ? 'ask' : 'message', text: a.text, state, availability: a.availability, chips: a.chips });
    } else if (cmd.type === 'detail') {
      const d = await detailWithPlace(state, cmd.index);
      if (d) return done({ kind: 'detail', text: d.text, state, detail: d.detail, chips: d.chips });
    } else {
      const d = draftOf(state, cmd.index);
      if (d) return done({ kind: 'message', text: d.text, state, draft: d.draft, chips: d.chips });
    }
    return done({ kind: 'message', text: `${cmd.index}번 숙소를 찾지 못했어요. 결과 표의 번호를 확인해 주세요.`, state, chips: [] });
  }

  const miss = missingInfo(state, needHome, places);
  if (miss) return done({ kind: 'ask', text: miss.text, state, understood: describe(state), chips: miss.chips });

  return done(await searchReply(state));
}

/** 현재 조건으로 검색해서 결과 답을 만들어요 (기본 파이프라인·비슷한 곳 찾기가 같이 써요) */
export async function searchReply(state: AgentState, lead = ''): Promise<AgentReply> {
  const r = searchOf(state);
  await attachPlaces(r.rows);
  const relax = r.total < 3 ? relaxOf(state) : [];
  const extras = await extrasFor(state);
  return {
    kind: 'result',
    text: lead + estimateNote(state, r.rows, resultText(r.total, r.rows.length, r.unknownCount, r.mustOk)),
    state,
    understood: describe(state),
    stages: r.stages,
    columns: r.columns,
    rows: r.rows,
    total: r.total,
    dropped: r.dropped,
    relax,
    extras,
    chips: relax.length ? relax.slice(0, 3).map((x) => x.label) : chipsFor(state, r.rows, relax.length),
  };
}

/**
 * 비슷한 곳 찾기: 기준 캠핑장의 특징을 정해진 방식으로 조건으로 바꿔요.
 * 유형(텐트·글램핑·카라반)은 필수, 개인화장실·입지·개별 화로대·작은 규모(조용함)는 선호, 위치는 기준 캠핑장에서 1시간 이내.
 */
export function similarState(camp: Camp, prev: AgentState): { state: AgentState; basis: string[] } {
  const m = siteMix(camp);
  const conds: AgentState['conds'] = [];
  const basis: string[] = [];
  if (m.tent) {
    conds.push({ key: 'tent', label: '텐트 사이트', kind: 'filter', must: true });
    basis.push('텐트 사이트');
  } else if (m.glamp) {
    conds.push({ key: 'induty:글램핑', label: '글램핑', kind: 'filter', must: true });
    basis.push('글램핑');
  } else if (m.carav) {
    conds.push({ key: 'induty:카라반', label: '카라반', kind: 'filter', must: true });
    basis.push('카라반');
  }
  const toilet = evalCond('toilet', camp, undefined, m.glamp ? ['글램핑'] : m.carav ? ['카라반'] : []);
  if (toilet.v === 'yes' || toilet.v === 'likely') {
    conds.push({ key: 'toilet', label: '개인화장실', kind: 'detail', must: false });
    basis.push('개인화장실');
  }
  const lct = (camp.lctCl || '').split(',').map((x) => x.trim()).find((x) => ['산', '숲', '계곡', '해변', '강', '호수'].includes(x));
  if (lct) {
    conds.push({ key: `lct:${lct}`, label: lct === '해변' ? '바다' : lct, kind: 'filter', must: false });
    basis.push(`${lct === '해변' ? '바다' : lct} 입지`);
  }
  if (camp.brazierCl === '개별') {
    conds.push({ key: 'brazier', label: '개별 화로대', kind: 'filter', must: false });
    basis.push('개별 화로대');
  }
  const sites = m.tent + m.glamp + m.carav;
  if (sites && sites <= 20) {
    conds.push({ key: 'judge:조용함', label: '조용함', kind: 'judge', must: false });
    basis.push(`작은 규모(${sites}곳)`);
  }
  const state: AgentState = {
    regions: [],
    conds,
    origin: camp.facltNm,
    originCoords: [Number(camp.mapY), Number(camp.mapX)],
    maxMinutes: 60,
    excludeIds: [camp.contentId],
    similarTo: camp.facltNm,
    // 날짜·인원·반려견은 지금 대화에서 말한 걸 이어 가요
    checkIn: prev.checkIn,
    nights: prev.nights,
    dateLabel: prev.dateLabel,
    season: prev.season,
    people: prev.people,
    pet: prev.pet,
    petSize: prev.petSize,
    petKg: prev.petKg,
    kids: prev.kids,
  };
  return { state, basis };
}

const josaWa = (w: string) => {
  const ch = w.charCodeAt(w.length - 1);
  return ch >= 0xac00 && ch <= 0xd7a3 && (ch - 0xac00) % 28 ? '과' : '와';
};
