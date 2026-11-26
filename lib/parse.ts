/**
 * 규칙 기반 조건 해석기.
 * LLM을 연결하기 전까지 쓰는 임시 버전이에요. 같은 AgentState를 돌려주도록 LLM 해석기로 갈아 끼우면 나머지는 그대로 동작해요.
 */
import { SLOT_LABEL, slotOf, ORIGINS, PROVINCES, seasonOf } from './data';
import type { AgentState, Cond, CondKind } from './types';

interface Rule {
  re: RegExp;
  key: string;
  label: string;
  kind: CondKind;
}

const RULES: Rule[] = [
  { re: /글램핑/, key: 'induty:글램핑', label: '글램핑', kind: 'filter' },
  { re: /카라반/, key: 'induty:카라반', label: '카라반', kind: 'filter' },
  { re: /오토\s*캠핑|자동차\s*야영/, key: 'induty:자동차야영장', label: '오토캠핑', kind: 'filter' },
  { re: /캠프닉/, key: 'induty:캠프닉', label: '캠프닉', kind: 'filter' },
  { re: /계곡/, key: 'lct:계곡', label: '계곡', kind: 'filter' },
  { re: /바다|해변|해수욕/, key: 'lct:해변', label: '바다', kind: 'filter' },
  { re: /숲속|숲/, key: 'lct:숲', label: '숲', kind: 'filter' },
  { re: /호수/, key: 'lct:호수', label: '호수', kind: 'filter' },
  { re: /강가|강변/, key: 'lct:강', label: '강', kind: 'filter' },
  { re: /\d+(\.\d+)?\s*k\s*w/i, key: 'power', label: '전력', kind: 'detail' },
  { re: /전기|전력/, key: 'sbrs:전기', label: '전기', kind: 'filter' },
  { re: /와이파이|wifi|인터넷/i, key: 'sbrs:무선인터넷', label: '와이파이', kind: 'filter' },
  { re: /온수/, key: 'sbrs:온수', label: '온수', kind: 'filter' },
  { re: /장작/, key: 'sbrs:장작판매', label: '장작 판매', kind: 'filter' },
  { re: /놀이터/, key: 'sbrs:놀이터', label: '놀이터', kind: 'filter' },
  { re: /물놀이|수영장/, key: 'sbrs:물놀이장', label: '물놀이장', kind: 'filter' },
  { re: /편의점|매점|마트/, key: 'sbrs:마트.편의점', label: '매점·편의점', kind: 'filter' },
  { re: /트램펄린|트렘폴린/, key: 'sbrs:트렘폴린', label: '트램펄린', kind: 'filter' },
  { re: /산책로/, key: 'sbrs:산책로', label: '산책로', kind: 'filter' },
  { re: /파쇄석/, key: 'floor:파쇄석', label: '파쇄석', kind: 'filter' },
  { re: /데크/, key: 'floor:데크', label: '데크', kind: 'filter' },
  { re: /잔디/, key: 'floor:잔디', label: '잔디', kind: 'filter' },
  { re: /트레일러|캠핑카/, key: 'trailer', label: '트레일러 입장', kind: 'filter' },
  { re: /온라인\s*(실시간)?\s*예약/, key: 'online', label: '온라인 예약', kind: 'filter' },
  { re: /(개인|개별|전용|내부)\s*화장실/, key: 'toilet', label: '개인화장실', kind: 'detail' },
  { re: /독채|단독\s*(건물|사용)|한\s*팀만/, key: 'detached', label: '독채', kind: 'filter' },
  { re: /취사|주방|요리\s*(가능|해\s*먹)/, key: 'cook', label: '객실 취사', kind: 'filter' },
  { re: /관광\s*펜션/, key: 'tourpension', label: '관광펜션 지정', kind: 'filter' },
  { re: /키즈\s*(펜션|풀빌라|풀|룸|시설)|놀이방|아이\s*(놀거리|놀이\s*시설)/, key: 'kidsfriendly', label: '키즈 시설', kind: 'filter' },
  { re: /난로|히터|난방\s*(기구|기)?\s*(대여|빌려)/, key: 'lend:난방기구', label: '난방기구 대여', kind: 'filter' },
  { re: /텐트\s*(대여|빌려)|장비\s*(대여|없이|빌려)|빈손/, key: 'lend:텐트', label: '텐트 대여', kind: 'filter' },
  { re: /침낭\s*(대여|빌려)/, key: 'lend:침낭', label: '침낭 대여', kind: 'filter' },
  { re: /타프\s*(가|이|도)?\s*(쳐져|쳐\s*있|설치|있는|구비|제공)|고정\s*타프|타프\s*존|그늘막\s*(이|가|도)?\s*(설치|제공|있)/, key: 'tarp', label: '설치된 타프·그늘막', kind: 'filter' },
  { re: /텐트\s*(를|도)?\s*(치|칠|설치|가져|들고)|내\s*텐트|텐트\s*사이트/, key: 'tent', label: '텐트 사이트', kind: 'filter' },
  { re: /샤워(실|장)\s*(이|가|도)?\s*(넉넉|많|여유|충분|안\s*붐비)/, key: 'plenty:샤워실', label: '샤워실 넉넉', kind: 'filter' },
  { re: /개수대\s*(이|가|도)?\s*(넉넉|많|여유|충분|안\s*붐비)/, key: 'plenty:개수대', label: '개수대 넉넉', kind: 'filter' },
  { re: /화장실\s*(이|가|도)?\s*(넉넉|많|여유|충분|안\s*붐비)/, key: 'plenty:화장실', label: '화장실 넉넉', kind: 'filter' },
  { re: /키즈\s*카페/, key: 'etc:키즈카페', label: '키즈카페', kind: 'filter' },
  { re: /(?<!키즈\s*)카페/, key: 'etc:카페', label: '카페', kind: 'filter' },
  { re: /식당|레스토랑/, key: 'etc:식당', label: '식당', kind: 'filter' },
  { re: /수영장|풀장|온수\s*풀|인피니티\s*풀/, key: 'etc:수영장', label: '수영장', kind: 'filter' },
  { re: /체험\s*(프로그램|활동|학습)|체험(이|도)?\s*(되|할|있|가능)/, key: 'program', label: '체험 프로그램', kind: 'filter' },
  { re: /(애견|반려\s*(견|동물)|강아지|개)\s*(동반)?\s*(이|가|은|는)?\s*(안\s*(되|오|받)|불가|없는|아닌|금지|싫)|애견\s*캠핑장\s*(말고|빼고|제외)/, key: 'nopet', label: '반려동물 없는 곳', kind: 'filter' },
  { re: /스파|자쿠지|노천탕|사우나|히노끼|월풀/, key: 'etc:스파', label: '스파·자쿠지', kind: 'filter' },
  { re: /족구/, key: 'etc:족구장', label: '족구장', kind: 'filter' },
  { re: /노래방/, key: 'etc:노래방', label: '노래방', kind: 'filter' },
  { re: /세미나|워크숍/, key: 'etc:세미나실', label: '세미나실', kind: 'filter' },
  { re: /일출|해돋이/, key: 'thema:일출명소', label: '해돋이 명소', kind: 'filter' },
  { re: /일몰|노을|석양/, key: 'thema:일몰명소', label: '노을 명소', kind: 'filter' },
  { re: /단풍/, key: 'thema:가을단풍명소', label: '단풍 명소', kind: 'filter' },
  { re: /눈꽃|설경/, key: 'thema:겨울눈꽃명소', label: '눈꽃 명소', kind: 'filter' },
  { re: /벚꽃|봄꽃|꽃\s*구경/, key: 'thema:봄꽃여행', label: '봄꽃 명소', kind: 'filter' },
  { re: /낚시/, key: 'near:낚시', label: '낚시', kind: 'filter' },
  { re: /수상\s*레저|카약|패들\s*보드|수상스키|제트스키/, key: 'near:수상레저', label: '수상레저', kind: 'filter' },
  { re: /해수욕/, key: 'near:해수욕', label: '해수욕', kind: 'filter' },
  { re: /서핑/, key: 'near:서핑', label: '서핑', kind: 'filter' },
  { re: /자전거|라이딩/, key: 'near:자전거', label: '자전거', kind: 'filter' },
  { re: /휴양림/, key: 'forest', label: '자연휴양림', kind: 'filter' },
  { re: /오션\s*뷰|바다\s*(가|이)?\s*(보이|전망|뷰)|바다\s*조망/, key: 'oceanview', label: '오션뷰', kind: 'filter' },
  { re: /새로\s*(생긴|연|오픈)|신규\s*(오픈|캠핑장)|오픈\s*한\s*지\s*얼마|신상/, key: 'new', label: '새로 연 곳', kind: 'filter' },
  { re: /노\s*키즈|아이\s*없는\s*(곳|캠핑)|성인\s*전용|어른만/, key: 'nokids', label: '노키즈존', kind: 'filter' },
  { re: /불멍|화로대\s*(사용|가능|되는|개별)|개별\s*화로/, key: 'brazier', label: '개별 화로대(불멍)', kind: 'filter' },
  { re: /조용/, key: 'judge:조용함', label: '조용함', kind: 'judge' },
  { re: /뷰|전망|경치/, key: 'judge:전망', label: '전망', kind: 'judge' },
  { re: /그늘/, key: 'judge:그늘', label: '그늘', kind: 'judge' },
  { re: /간격|널찍|넓은\s*사이트|프라이빗/, key: 'judge:사이트 간격 넓음', label: '사이트 간격 넓음', kind: 'judge' },
  { re: /바비큐|바베큐/, key: 'judge:바비큐', label: '바비큐', kind: 'judge' },
  { re: /깨끗|청결/, key: 'judge:청결', label: '청결', kind: 'judge' },
];

const PREF = /(좋겠|좋을|있으면|있었으면|선호|되면\s*좋|웬만하면|가능하면)/;
const MUST = /(필요|꼭|필수|무조건|해야|반드시|있어야)/;

/** 조건이 나온 자리 뒤쪽 말투로 필수/선호를 가려요. */
function isMust(text: string, index: number) {
  const tail = text.slice(index, index + 18).split(/[,.!?\n]/)[0];
  if (MUST.test(tail)) return true;
  if (PREF.test(tail)) return false;
  const head = text.slice(Math.max(0, index - 6), index);
  if (/꼭|반드시|무조건/.test(head)) return true;
  if (/가능하면|웬만하면/.test(head)) return false;
  return true;
}

function upsert(conds: Cond[], c: Cond) {
  const i = conds.findIndex((x) => x.key.split(':')[0] === c.key.split(':')[0] && x.key === c.key);
  if (i >= 0) conds[i] = c;
  else conds.push(c);
}

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function weekendLabel(sat: Date) {
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  return `${sat.getMonth() + 1}/${sat.getDate()}(토)–${sun.getMonth() + 1}/${sun.getDate()}(일)`;
}

function nextWeekend(today: Date, weeksAhead: number) {
  const d = new Date(today);
  const day = d.getDay(); // 0 일 ~ 6 토
  const toSat = (6 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + (day === 6 ? 0 : toSat) + 7 * weeksAhead);
  return d;
}

/** 판단형으로 들어온 조건 이름이 사실 데이터로 확인되는 조건이면 그 규칙을 돌려줘요 (예: "난로 대여" → 난방기구 대여) */
export function ruleFor(label: string) {
  const r = RULES.find((x) => x.kind !== 'judge' && x.re.test(label));
  return r ? { key: r.key, label: r.label, kind: r.kind } : null;
}

export type Command =
  | { type: 'availability'; index: number }
  | { type: 'detail'; index: number }
  | { type: 'draft'; index: number }
  | { type: 'reset' };

/** 숙소 유형(오토캠핑·글램핑·카라반 등)은 새로 말하면 바꾸는 것으로 봐요.
 *  "이번엔 오토캠핑으로"라고 하면 앞에서 말한 글램핑 조건은 빼요. "카라반도", "카라반까지"처럼 더하는 말이면 그대로 둬요. */
const TYPE_WORDS: Record<string, RegExp> = {
  글램핑: /글램핑/,
  카라반: /카라반|캠핑카/,
  자동차야영장: /오토\s*캠핑|오토캠|자동차\s*야영/,
  캠프닉: /캠프닉|당일\s*캠핑/,
  일반야영장: /일반\s*(캠핑|야영)/,
};
/** 숙소 종류에 맞게 조건을 정리해요.
 *  펜션이면 인원·가격을 조건으로 세우고 캠핑 전용 조건(유형·텐트·화로대 등)은 빼요. 캠핑장이면 그 반대예요. */
const CAMP_ONLY = /^(induty:|tent$|brazier$|trailer$|power|floor:|lend:|plenty:|tarp$|toilet$|program$|forest$|sbrs:|judge:사이트)/;
const PENSION_ONLY = /^(detached$|cook$|tourpension$|kidsfriendly$|capacity:|price:)/;
export function normalizeCategory(state: AgentState, conds: Cond[]): Cond[] {
  if (state.category !== 'pension') return conds.filter((c) => !PENSION_ONLY.test(c.key));
  const out = conds.filter((c) => !CAMP_ONLY.test(c.key) && !/^(capacity|price):/.test(c.key));
  if (state.people) out.unshift({ key: `capacity:${state.people}`, label: `${state.people}명 묵을 수 있음`, kind: 'filter', must: true });
  if (state.maxPrice) {
    const slot = slotOf(state.checkIn);
    out.push({ key: `price:${state.maxPrice}${slot ? `:${slot}` : ''}`, label: `1박 ${Math.round(state.maxPrice / 10000)}만 원 이하${slot ? ` (${SLOT_LABEL[slot]})` : ''}`, kind: 'filter', must: true });
  }
  return out;
}

export function switchTypes(conds: Cond[], text: string): Cond[] {
  const said = Object.entries(TYPE_WORDS).filter(([, re]) => re.test(text)).map(([k]) => k);
  if (!said.length) return conds;
  const adding = Object.values(TYPE_WORDS).some((re) => new RegExp(`(${re.source})\\s*(도|까지|추가|포함|같이)`).test(text));
  if (adding) return conds;
  return conds.filter((c) => !c.key.startsWith('induty:') || said.includes(c.key.slice(7)));
}

export function parse(text: string, prev: AgentState, regionNames: string[], today = new Date()) {
  const state: AgentState = structuredClone(prev);
  state.conds = [...(state.conds || [])];
  state.regions = [...(state.regions || [])];
  const t = text.replace(/\s+/g, ' ').trim();
  const commands: Command[] = [];

  if (/처음부터|새로\s*찾/.test(t)) {
    commands.push({ type: 'reset' });
    return { state: { regions: [], conds: [] } as AgentState, commands };
  }

  // N번 자세히 / N번 문의 / N번 빈자리
  const ref = t.match(/(\d+)\s*번/);
  if (ref && /빈자리|남은\s*자리|자리\s*있|예약\s*가능/.test(t)) {
    commands.push({ type: 'availability', index: Number(ref[1]) });
    return { state, commands };
  }
  if (ref && /자세히|상세|정보|보여/.test(t) && !/문의|메시지|물어/.test(t)) {
    commands.push({ type: 'detail', index: Number(ref[1]) });
    return { state, commands };
  }
  if (ref && /문의|메시지|물어/.test(t)) {
    commands.push({ type: 'draft', index: Number(ref[1]) });
    return { state, commands };
  }

  // 조건 빼기: "전기 조건 빼고", "와이파이 없어도 돼"
  const drop = t.match(/([가-힣A-Za-z]+)\s*(조건)?\s*(빼|없어도|제외|상관없)/);
  if (drop) {
    const word = drop[1];
    state.conds = state.conds.filter((c) => !c.label.includes(word) && !word.includes(c.label));
    if (/반려|강아지/.test(word)) state.pet = false;
    if (/지역|포천|가평/.test(word)) state.regions = [];
  }

  // 출발지
  const originHit = Object.keys(ORIGINS).find((o) => new RegExp(`${o}(에서|출발|이에요|이야|요)`).test(t) || new RegExp(`출발지?\\s*(는|은)?\\s*${o}`).test(t));
  if (originHit) {
    state.origin = originHit;
    delete state.originCoords;
  }

  // 이동 시간 "2시간 이내", "1시간 30분까지", "90분"
  const h = t.match(/(\d+(?:\.\d+)?)\s*시간(?:\s*(\d+)\s*분)?\s*(이내|안|이하|까지|안쪽|정도)?/);
  const m = t.match(/(?<!시간\s*)(\d+)\s*분\s*(이내|안|이하|까지)/);
  if (h) state.maxMinutes = Math.round(Number(h[1]) * 60 + Number(h[2] || 0));
  else if (m) state.maxMinutes = Number(m[1]);

  // 지역: 시·군·구, 시·도
  for (const full of regionNames) {
    const short = full.replace(/(시|군|구)$/, '');
    if (short.length < 2) continue;
    if (originHit && (short === originHit)) continue;
    if (t.includes(short) && !state.regions.includes(full)) state.regions.push(full);
  }
  for (const p of Object.keys(PROVINCES)) {
    if (new RegExp(`${p}(도|특별|$|\\s|에|쪽|권)`).test(t) && !state.regions.includes(p) && p !== originHit) {
      // 시·군 이름에 포함된 경우(예: 경기 광주)는 시·도도 함께 넣어도 무방
      state.regions.push(p);
    }
  }

  // 인원
  const ppl = t.match(/(\d+)\s*(명|인)/);
  if (ppl) state.people = Number(ppl[1]);
  // 아이와 함께 가는지 (노키즈존을 빼려고). "노키즈", "아이 없이"는 제외
  if (/아이(들)?\s*(랑|와|하고|둘|셋|넷|한\s*명|\d|데리고|동반|도)|아기|애기|유아|어린이|초등학생|유치원|가족\s*(캠핑|여행|끼리)/.test(t) && !/아이\s*없이/.test(t)) state.kids = true;

  // 날짜
  if (/다음\s*주\s*주말/.test(t)) {
    const d = nextWeekend(today, 1);
    state.dateLabel = weekendLabel(d);
    state.checkIn = isoOf(d);
    state.nights = 1;
    state.season = seasonOf(d.getMonth() + 1);
  } else if (/이번\s*주말|주말에/.test(t)) {
    const d = nextWeekend(today, 0);
    state.dateLabel = weekendLabel(d);
    state.checkIn = isoOf(d);
    state.nights = 1;
    state.season = seasonOf(d.getMonth() + 1);
  } else {
    const md = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/) ?? t.match(/(?<![\d./])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/);
    if (md) {
      const d = new Date(today.getFullYear(), Number(md[1]) - 1, Number(md[2]));
      if (d.getTime() < today.getTime() - 86_400_000) d.setFullYear(d.getFullYear() + 1);
      state.checkIn = isoOf(d);
      state.nights = 1;
      state.dateLabel = `${md[1]}/${md[2]}`;
      state.season = seasonOf(Number(md[1]));
    }
  }

  // 반려견 ("애견동반 안 되는 곳"처럼 반려동물이 없는 곳을 찾는 말은 빼고 봐요)
  const tPet = t.replace(/(애견|반려\s*(견|동물)|강아지|개)\s*(동반)?\s*(이|가|은|는)?\s*(안\s*(되|오|받)|불가|없는|아닌|금지|싫)|애견\s*캠핑장\s*(말고|빼고|제외)/g, ' ');
  if (/강아지|반려견|애견|댕댕|반려동물|멍멍/.test(tPet) && !drop) state.pet = true;
  // 몸무게를 말하면 그게 가장 정확해요. 캠핑장의 "소형견" 기준이 5kg~10kg로 제각각이라 5~10kg은 따로(mid) 봐요.
  const kgs = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(?:~\s*(\d+(?:\.\d+)?)\s*)?(?:kg|킬로|키로)/gi)];
  if (kgs.length) {
    const nums = kgs.flatMap((m) => [m[1], m[2]].filter(Boolean).map(Number));
    const n = Math.max(...nums);
    state.petKg = n;
    state.petSize = /이상|넘/.test(t) && n >= 10 ? 'big' : n <= 5 ? 'small' : n <= 10 ? 'mid' : 'big';
    state.pet = true;
  } else if (/중형|대형/.test(t)) {
    state.petSize = 'big';
    state.pet = true;
    delete state.petKg;
  } else if (/소형/.test(t)) {
    state.petSize = 'small';
    state.pet = true;
    delete state.petKg;
  }

  // 시설·입지·유형·판단 조건
  if (!drop) {
    for (const r of RULES) {
      const found = r.re.exec(t);
      if (!found) continue;
      const must = isMust(t, found.index);
      if (r.key === 'power') {
        const kw = found[0].match(/\d+(\.\d+)?/)?.[0];
        upsert(state.conds, { key: `power:${kw}`, label: `전력 ${kw}kW 이상`, kind: 'detail', must });
        upsert(state.conds, { key: 'sbrs:전기', label: '전기', kind: 'filter', must });
        continue;
      }
      if (r.key === 'sbrs:전기' && state.conds.some((c) => c.key.startsWith('power'))) continue;
      // "오션뷰"는 오션뷰 조건 하나로 봐요 (일반 "전망"과 겹치지 않게)
      if (r.key === 'judge:전망' && /오션\s*뷰|바다\s*(가|이)?\s*(보이|전망|뷰)|바다\s*조망/.test(t) && !/산\s*(뷰|전망)|숲\s*뷰|호수\s*뷰|강\s*뷰|계곡\s*뷰/.test(t)) continue;
      upsert(state.conds, { key: r.key, label: r.label, kind: r.kind, must });
    }
  }

  // 숙소 종류: 펜션·독채·풀빌라·민박이면 펜션, 캠핑·글램핑·카라반·야영이면 캠핑장
  if (/펜션|독채|풀빌라|민박/.test(t)) state.category = 'pension';
  else if (/캠핑|글램핑|카라반|야영|캠프|오토캠/.test(t)) state.category = 'camp';
  // 가격: "20만 원 이하", "1박 15만원까지"
  const price = t.match(/(\d+(?:\.\d+)?)\s*만\s*원?\s*(이하|이내|까지|안쪽|밑|아래|미만)/);
  if (price) state.maxPrice = Math.round(Number(price[1]) * 10000);
  state.conds = normalizeCategory(state, switchTypes(state.conds, text));
  return { state, commands };
}
