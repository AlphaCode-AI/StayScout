import { PROVINCES, seasonOf } from './data';
import { interpretWithGemini, type LlmResult } from './llm';
import { normalizeCategory, parse, ruleFor, switchTypes, type Command } from './parse';
import type { AgentState, Cond, Places } from './types';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 지난 날짜(YYYY-MM-DD)면 같은 월·일의 다가오는 날짜로 바꿔요 */
export function futureDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const now = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  if (iso >= now) return iso;
  for (let y = Number(now.slice(0, 4)); y <= Number(now.slice(0, 4)) + 1; y++) {
    const c = `${y}-${m[2]}-${m[3]}`;
    if (c >= now) return c;
  }
  return iso;
}

export function dateLabel(checkIn: string, nights = 1) {
  const d = new Date(`${checkIn}T00:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  const out = new Date(d);
  out.setDate(d.getDate() + Math.max(1, nights));
  const f = (x: Date) => `${x.getMonth() + 1}/${x.getDate()}(${DAYS[x.getDay()]})`;
  return { label: `${f(d)}–${f(out)}`, season: seasonOf(d.getMonth() + 1) };
}

const strip = (s: string) => s.replace(/\s/g, '').replace(/(특별자치도|특별자치시|특별시|광역시|도|시|군|구)$/, '');

function normalizeRegions(names: string[], regionNames: string[]) {
  const out: string[] = [];
  for (const raw of names) {
    const r = strip(raw);
    if (!r) continue;
    const prov = Object.keys(PROVINCES).find((p) => p === r || strip(p) === r);
    const sig = regionNames.find((g) => strip(g) === r);
    if (sig) out.push(sig);
    else if (prov) out.push(prov);
  }
  return [...new Set(out)];
}

const VALID = /^(induty|lct|sbrs|floor|lend|plenty|etc|thema|near):.+$|^(trailer|online|toilet|power|judge|brazier|tent|program|nokids|tarp|nopet|forest|oceanview|new|detached|cook|tourpension|kidsfriendly)$/;

/** 모델이 다른 이름으로 준 값을 데이터에 있는 이름으로 맞춰요. 목록에 없으면 null → 판단형 조건으로 */
const CANON: Record<string, Record<string, string[]>> = {
  induty: { 글램핑: [], 카라반: [], 자동차야영장: ['오토캠핑', '오토캠핑장', '자동차야영'], 일반야영장: ['일반캠핑'], 캠프닉: [] },
  lct: { 해변: ['바다', '해수욕장', '바닷가', '해안'], 계곡: [], 숲: ['숲속'], 산: [], 강: ['강변', '강가'], 호수: [], 섬: [], 도심: [] },
  sbrs: {
    전기: [],
    무선인터넷: ['와이파이', 'wifi', '인터넷', '유무선인터넷'],
    온수: [],
    장작판매: ['장작'],
    놀이터: [],
    물놀이장: ['수영장', '물놀이'],
    '마트.편의점': ['편의점', '매점', '마트'],
    트렘폴린: ['트램펄린', '트램폴린'],
    산책로: [],
    운동시설: [],
    운동장: [],
  },
  floor: { 잔디: [], 파쇄석: [], 데크: ['테크'], 자갈: [], 맨흙: ['흙'] },
  plenty: { 샤워실: ['샤워장', '샤워'], 개수대: [], 화장실: [] },
  etc: { 카페: [], 키즈카페: [], 식당: ['레스토랑'], 수영장: ['풀장', '온수풀', '풀'], 스파: ['자쿠지', '노천탕', '사우나'], 족구장: ['족구'], 노래방: [], 세미나실: ['세미나', '워크숍'] },
  thema: { 일출명소: ['일출', '해돋이'], 일몰명소: ['일몰', '노을'], 가을단풍명소: ['단풍'], 겨울눈꽃명소: ['눈꽃'], 봄꽃여행: ['벚꽃', '봄꽃'] },
  near: { 낚시: [], 수상레저: ['카약', '패들보드'], 해수욕: [], 서핑: [], 자전거: ['라이딩'] },
  lend: { 난방기구: ['난로', '히터', '난방기'], 텐트: [], 침낭: [], 화로대: [], 식기: [], 릴선: [] },
};

function canonical(type: string, value: string) {
  const table = CANON[type];
  if (!table) return null;
  const v = value.replace(/\s/g, '').toLowerCase();
  for (const [name, alias] of Object.entries(table)) {
    if (name.toLowerCase() === v || alias.some((a) => a.toLowerCase() === v)) return name;
  }
  return null;
}

const LABELS: Record<string, string> = { 무선인터넷: '와이파이', 장작판매: '장작 판매', '마트.편의점': '매점·편의점', 자동차야영장: '오토캠핑', 해변: '바다', 트렘폴린: '트램펄린' };

function toConds(list: NonNullable<LlmResult['conditions']>): Cond[] {
  const conds: Cond[] = [];
  const push = (c: Cond) => {
    if (!conds.some((x) => x.key === c.key)) conds.push(c);
  };
  for (const c of list) {
    const key = (c.key || '').trim();
    const label = (c.label || '').trim() || key;
    if (key.startsWith('power')) {
      const kw = (c.value || key.split(':')[1] || label).match(/\d+(\.\d+)?/)?.[0];
      if (kw) push({ key: `power:${kw}`, label: `전력 ${kw}kW 이상`, kind: 'detail', must: c.must });
      push({ key: 'sbrs:전기', label: '전기', kind: 'filter', must: c.must });
      continue;
    }
    if (key === 'forest' || key === 'oceanview' || key === 'new') {
      push({ key, label: { forest: '자연휴양림', oceanview: '오션뷰', new: '새로 연 곳' }[key]!, kind: 'filter', must: c.must });
      continue;
    }
    if (key === 'nopet') {
      push({ key, label: '반려동물 없는 곳', kind: 'filter', must: c.must });
      continue;
    }
    if (key === 'tarp') {
      push({ key, label: '설치된 타프·그늘막', kind: 'filter', must: c.must });
      continue;
    }
    if (key === 'nokids') {
      push({ key, label: '노키즈존', kind: 'filter', must: c.must });
      continue;
    }
    if (key === 'program') {
      push({ key, label: '체험 프로그램', kind: 'filter', must: c.must });
      continue;
    }
    if (key === 'tent') {
      push({ key, label: '텐트 사이트', kind: 'filter', must: c.must });
      continue;
    }
    if (key === 'brazier') {
      push({ key, label: '개별 화로대(불멍)', kind: 'filter', must: c.must });
      continue;
    }
    if (key === 'toilet') {
      push({ key, label: '개인화장실', kind: 'detail', must: c.must });
      continue;
    }
    if (key === 'judge' || !VALID.test(key)) {
      const r = ruleFor(label);
      push(r ? { ...r, must: c.must } : { key: `judge:${label}`, label, kind: 'judge', must: c.must });
      continue;
    }
    const [type, value] = key.split(':');
    if (value !== undefined) {
      const name = canonical(type, value) ?? canonical(type, label);
      if (!name) {
        const r = ruleFor(label);
        push(r ? { ...r, must: c.must } : { key: `judge:${label}`, label, kind: 'judge', must: c.must });
        continue;
      }
      const THEMA_LABEL: Record<string, string> = { 일출명소: '해돋이 명소', 일몰명소: '노을 명소', 가을단풍명소: '단풍 명소', 겨울눈꽃명소: '눈꽃 명소', 봄꽃여행: '봄꽃 명소' };
      const lbl =
        type === 'lend' ? `${name} 대여` : type === 'plenty' ? `${name} 넉넉` : type === 'thema' ? THEMA_LABEL[name] ?? name : name === '스파' ? '스파·자쿠지' : LABELS[name] ?? name;
      push({ key: `${type}:${name}`, label: lbl, kind: 'filter', must: c.must });
      continue;
    }
    push({ key, label, kind: 'filter', must: c.must });
  }
  return conds;
}

const HOME_RE = /우리\s*집|집에서|집\s*기준|집\s*출발/;
const HERE_RE = /현재\s*위치|지금\s*위치|여기서|여기에서/;

/** "우리 집에서", "현재 위치에서"를 브라우저가 준 좌표로 바꿔요. 집 주소를 모르면 needHome = true */
export function applyPlaces(text: string, state: AgentState, places?: Places) {
  let needHome = false;
  if (HERE_RE.test(text) && places?.current) {
    state.origin = places.current.label ? `현재 위치(${places.current.label})` : '현재 위치';
    state.originCoords = [places.current.lat, places.current.lng];
  } else if (HOME_RE.test(text)) {
    if (places?.home) {
      state.origin = `우리 집(${places.home.label})`;
      state.originCoords = [places.home.lat, places.home.lng];
    } else needHome = true;
  }
  return needHome;
}

export async function interpret(
  text: string,
  prev: AgentState,
  regionNames: string[],
  originOk: (name: string) => boolean,
  today = new Date(),
): Promise<{ state: AgentState; commands: Command[]; engine: 'gemini' | 'rules' }> {
  const rules = parse(text, prev, regionNames, today);
  if (rules.commands.some((c) => c.type === 'availability')) return { ...rules, engine: 'rules' };
  const llm = await interpretWithGemini(text, prev, today);
  if (!llm) return { ...rules, engine: 'rules' };

  if (llm.intent === 'reset') return { state: { regions: [], conds: [] }, commands: [{ type: 'reset' }], engine: 'gemini' };
  if ((llm.intent === 'detail' || llm.intent === 'draft') && llm.refIndex) {
    return { state: prev, commands: [{ type: llm.intent, index: llm.refIndex }], engine: 'gemini' };
  }
  if (rules.commands.length) return { ...rules, engine: 'rules' };

  const state = mergeDelta(llm, prev, rules.state, regionNames, originOk, text);
  return { state, commands: [], engine: 'gemini' };
}

/** Gemini가 돌려준 "바뀐 것"을 기존 조건에 합치고, 규칙 기반 해석으로 빠진 것을 채워요. */
export function mergeDelta(
  llm: LlmResult,
  prev: AgentState,
  rulesState: AgentState,
  regionNames: string[],
  originOk: (name: string) => boolean,
  text = '',
): AgentState {
  // 바뀐 것만 받아서 기존 조건에 합쳐요.
  const state: AgentState = structuredClone(prev);
  state.conds = [...(prev.conds || [])];
  state.regions = [...(prev.regions || [])];
  if (llm.origin && originOk(strip(llm.origin))) {
    state.origin = strip(llm.origin);
    delete state.originCoords;
  }
  if (llm.clearTravel) delete state.maxMinutes;
  if (llm.maxMinutes && llm.maxMinutes > 0) state.maxMinutes = llm.maxMinutes;
  if (llm.clearRegions) state.regions = [];
  for (const r of normalizeRegions(llm.regions || [], regionNames)) {
    if (strip(r) !== state.origin && !state.regions.includes(r)) state.regions.push(r);
  }
  if (llm.checkIn) {
    // 사용자가 박 수를 말하지 않았으면 1박으로 봐요 (모델이 주말을 2박으로 잡는 경우가 있어요)
    const nights = llm.nights && llm.nights > 1 && /\d\s*박|연박|이틀|사흘|2박|3박/.test(text) ? llm.nights : 1;
    // 모델이 연도를 틀리게 쓰는 경우가 있어요 ("12월 둘째주"를 작년 날짜로). 지난 날짜면 올해·내년으로 옮겨요.
    const checkIn = futureDate(llm.checkIn);
    const d = dateLabel(checkIn, nights);
    if (d) {
      state.checkIn = checkIn;
      state.nights = nights;
      state.dateLabel = d.label;
      state.season = d.season;
    }
  }
  if (llm.people && llm.people > 0) state.people = llm.people;
  if (llm.category === 'camp' || llm.category === 'pension') state.category = llm.category;
  if (llm.maxPrice && llm.maxPrice > 0) state.maxPrice = llm.maxPrice;
  if (llm.pet) state.pet = true;
  if (llm.petSize === 'small' || llm.petSize === 'big') {
    state.pet = true;
    state.petSize = llm.petSize;
  }
  if (llm.removeKeys?.length) {
    const rm = llm.removeKeys.map((k) => k.trim()).filter((k) => k.length <= 30);
    const powerRemoved = rm.some((k) => k.startsWith('power') || k.includes('전력'));
    state.conds = state.conds.filter(
      (c) => !rm.some((k) => k === c.key || k === c.label || c.label.includes(k)) && !(powerRemoved && (c.key.startsWith('power') || c.key === 'sbrs:전기')),
    );
    if (rm.some((k) => /반려|강아지|pet/.test(k))) {
      state.pet = false;
      delete state.petSize;
    }
  }
  for (const c of toConds(llm.conditions || [])) {
    const i = state.conds.findIndex((x) => x.key === c.key);
    if (i >= 0) state.conds[i] = c;
    else state.conds.push(c);
  }

  // 규칙 기반 결과로 Gemini가 빠뜨린 것을 채워요. (무료 모델이 가끔 조건을 놓쳐요)
  const r = rulesState;
  if (!state.maxMinutes && r.maxMinutes && !llm.clearTravel) state.maxMinutes = r.maxMinutes;
  if (!state.origin && r.origin) state.origin = r.origin;
  if (r.origin && r.origin !== prev.origin && state.origin === r.origin) delete state.originCoords;
  if (!state.dateLabel && r.dateLabel) {
    state.dateLabel = r.dateLabel;
    state.season = r.season;
  }
  if (!state.checkIn && r.checkIn) {
    state.checkIn = r.checkIn;
    state.nights = r.nights;
  }
  if (!state.people && r.people) state.people = r.people;
  if (r.pet && !state.pet) state.pet = true;
  if (r.kids && !state.kids) state.kids = true;
  if (r.petSize && !state.petSize) state.petSize = r.petSize;
  // 이번에 몸무게를 말했으면 Gemini 분류보다 몸무게 기준을 따라요 (예: 7kg 푸들 → 5~10kg 구간)
  if (/\d\s*(kg|킬로|키로)/i.test(text) && r.petKg) {
    state.petSize = r.petSize;
    state.petKg = r.petKg;
  }
  if (!llm.clearRegions) for (const g of r.regions) if (!state.regions.includes(g)) state.regions.push(g);
  const removedByRules = (prev.conds || []).filter((c) => !r.conds.some((x) => x.key === c.key)).map((c) => c.key);
  state.conds = state.conds.filter((c) => !removedByRules.includes(c.key));
  const llmRemoved = new Set((prev.conds || []).filter((c) => !state.conds.some((x) => x.key === c.key)).map((c) => c.key));
  for (const c of r.conds) {
    if (llmRemoved.has(c.key)) continue;
    if (c.kind === 'judge' && state.conds.some((x) => x.kind === 'judge')) continue;
    const powerDup = c.key.startsWith('power') && state.conds.some((x) => x.key.startsWith('power'));
    if (!powerDup && !state.conds.some((x) => x.key === c.key)) state.conds.push(c);
  }
  // 규칙 해석이 이번 말에서 숙소 종류나 가격을 잡았으면 반영해요 (Gemini가 놓칠 때 대비)
  if (r.category && r.category !== prev.category && !llm.category) state.category = r.category;
  if (r.maxPrice && r.maxPrice !== prev.maxPrice && !llm.maxPrice) state.maxPrice = r.maxPrice;
  state.conds = normalizeCategory(state, switchTypes(state.conds, text));
  return state;
}
