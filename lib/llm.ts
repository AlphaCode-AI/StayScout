/**
 * Gemini 조건 해석기.
 * 사용자의 말 + 지금까지의 조건(state)을 받아 "갱신된 전체 조건"을 JSON으로 돌려받아요.
 * 실패하거나 키가 없으면 null을 돌려주고, 호출하는 쪽에서 규칙 기반 해석으로 넘어가요.
 */
import type { AgentState } from './types';

export interface LlmResult {
  intent: 'search' | 'detail' | 'draft' | 'reset';
  refIndex?: number;
  origin?: string;
  maxMinutes?: number;
  regions?: string[];
  checkIn?: string;
  nights?: number;
  people?: number;
  pet?: boolean;
  petSize?: 'small' | 'big' | 'unknown';
  conditions?: { key: string; label: string; must: boolean; value?: string }[];
  removeKeys?: string[];
  clearRegions?: boolean;
  clearTravel?: boolean;
}

export const CATALOG = `
- induty:글램핑 | induty:카라반 | induty:자동차야영장(오토캠핑) | induty:캠프닉
- lct:계곡 | lct:해변(바다) | lct:숲 | lct:산 | lct:강 | lct:호수 | lct:섬 | lct:도심
- sbrs:전기 | sbrs:무선인터넷(와이파이) | sbrs:온수 | sbrs:장작판매 | sbrs:놀이터 | sbrs:물놀이장(수영장) | sbrs:마트.편의점 | sbrs:트렘폴린 | sbrs:산책로 | sbrs:운동시설 | sbrs:운동장
- floor:잔디 | floor:파쇄석 | floor:데크 | floor:자갈 | floor:맨흙
- trailer (개인 트레일러·캠핑카 입장)
- online (온라인 예약 가능)
- power (사이트 전력 용량. value에 kW 숫자)
- toilet (개인·개별·객실 내 화장실)
- lend:난방기구(난로·히터 대여) | lend:텐트(장비 없이) | lend:침낭 | lend:화로대 | lend:식기 | lend:릴선
- brazier (개별 화로대 사용 가능, 불멍)
- plenty:샤워실 | plenty:개수대 | plenty:화장실 (사이트 수에 비해 넉넉한지)
- etc:카페 | etc:키즈카페 | etc:식당 | etc:수영장(풀장·온수풀. 물놀이장과 다름)
- program (아이 체험 프로그램)
- nokids (노키즈존·성인 전용)
- nopet (반려동물 동반 불가인 곳을 원함. 애견동반 캠핑장이 싫을 때)
- etc:스파 | etc:족구장 | etc:노래방 | etc:세미나실
- thema:일출명소(해돋이) | thema:일몰명소(노을) | thema:가을단풍명소 | thema:겨울눈꽃명소 | thema:봄꽃여행
- near:낚시 | near:수상레저 | near:해수욕 | near:서핑 | near:자전거 (주변에서 할 수 있는 레저)
- forest (자연휴양림) | oceanview (바다가 보이는 곳) | new (1년 안에 새로 연 곳)
- tarp (사이트에 타프·그늘막이 미리 설치된 곳, 타프존)
- tent (텐트를 칠 수 있는 사이트가 있는 곳. 카라반·글램핑 객실만 있는 곳 제외)
- judge (위 목록에 없는 모든 조건. 예: 조용함, 전망, 그늘, 청결, 바비큐, 아이 놀기 좋음, 사이트 간격 넓음 등. label은 짧은 한국어 명사)`;

export const SCHEMA = {
  type: 'OBJECT',
  properties: {
    intent: { type: 'STRING', enum: ['search', 'detail', 'draft', 'reset'] },
    refIndex: { type: 'INTEGER' },
    origin: { type: 'STRING' },
    maxMinutes: { type: 'INTEGER' },
    regions: { type: 'ARRAY', items: { type: 'STRING' } },
    checkIn: { type: 'STRING' },
    nights: { type: 'INTEGER' },
    people: { type: 'INTEGER' },
    pet: { type: 'BOOLEAN' },
    petSize: { type: 'STRING', enum: ['small', 'big', 'unknown'] },
    removeKeys: { type: 'ARRAY', items: { type: 'STRING' } },
    clearRegions: { type: 'BOOLEAN' },
    clearTravel: { type: 'BOOLEAN' },
    conditions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          key: { type: 'STRING' },
          label: { type: 'STRING' },
          must: { type: 'BOOLEAN' },
          value: { type: 'STRING' },
        },
        required: ['key', 'label', 'must'],
      },
    },
  },
  required: ['intent'],
};

function prompt(text: string, prev: AgentState, today: Date) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}(${days[today.getDay()]})`;
  const sat = new Date(today);
  sat.setDate(today.getDate() + ((6 - today.getDay() + 7) % 7));
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const nextSat = new Date(sat);
  nextSat.setDate(sat.getDate() + 7);
  const current = {
    origin: prev.origin,
    maxMinutes: prev.maxMinutes,
    regions: prev.regions,
    checkIn: prev.checkIn,
    nights: prev.nights,
    people: prev.people,
    pet: prev.pet,
    petSize: prev.petSize,
    conditions: prev.conds.map((c) => ({ key: c.key, label: c.label, must: c.must })),
  };
  return `너는 숙소(캠핑장) 검색 에이전트의 조건 해석기야. 사용자의 새 말에서 "새로 나왔거나 바뀐 것만" JSON으로 돌려줘. 바뀌지 않은 필드는 아예 넣지 마.

오늘: ${todayStr} · 이번 주말 토요일: ${iso(sat)} · 다음주 주말 토요일: ${iso(nextSat)}

[지금까지의 조건] (참고용. 다시 돌려주지 마)
${JSON.stringify(current)}

[사용자의 새 말]
${text}

[규칙]
- intent: 조건을 말하거나 바꾸면 search. "N번 자세히/정보"는 detail, "N번에 문의/물어봐"는 draft (refIndex=N). "처음부터 다시"는 reset.
- 새 조건은 conditions에. must: "꼭, 필요, 필수, 있어야" 또는 별말 없으면 true. "있으면 좋겠어, 가능하면, 선호, 면 좋겠어"는 false.
- 조건을 빼라고 하면 removeKeys에 지금까지의 조건의 key를 넣어. 지역을 빼면 clearRegions true, 이동 시간 제한을 빼면 clearTravel true.
- conditions의 key는 아래 목록에서만 골라. 목록에 없는 조건도 버리지 말고 key "judge"로 넣어. 날짜·인원·지역·출발지·반려견·이동 시간은 conditions에 넣지 말고 각자의 필드에 넣어.
${CATALOG}
- power는 value에 kW 숫자만 (예: "2").
- origin: 출발 도시 이름만 (예: "성남"). "우리 집", "현재 위치"는 넣지 마.
- regions: 가고 싶은 시·군이나 시·도 이름만 (예: "포천", "가평", "강원"). 출발지나 "2시간 이내" 같은 표현은 넣지 마.
- maxMinutes: "2시간 이내" → 120.
- checkIn: 체크인 날짜 YYYY-MM-DD. "이번 주말", "다음주 주말"은 위에 적힌 날짜를 그대로 써. nights 기본 1.
- pet: 강아지·반려견 동반이면 true. petSize: 10kg 미만·소형·말티즈·푸들·포메 같은 소형견이면 small, 중·대형이면 big, 모르면 넣지 마.`;
}

// 무료 등급 한도(429)에 걸린 모델은 잠시 건너뛰어요.
const cooldown = new Map<string, number>();

export async function interpretWithGemini(text: string, prev: AgentState, today = new Date()): Promise<LlmResult | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  // 빠르고 정확한 순서. thinking은 낮게 두어 2초 안팎으로 응답하게 해요.
  const models: { name: string; thinking?: string }[] = [
    ...(process.env.GEMINI_MODEL ? [{ name: process.env.GEMINI_MODEL }] : []),
    { name: 'gemini-3.5-flash', thinking: 'low' },
    { name: 'gemini-flash-lite-latest' },
  ];
  for (const { name: model, thinking } of models) {
    if ((cooldown.get(model) ?? 0) > Date.now()) continue;
    try {
      const generationConfig: Record<string, unknown> = { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA };
      if (thinking) generationConfig.thinkingConfig = { thinkingLevel: thinking };
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt(text, prev, today) }] }], generationConfig }),
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) {
        if (res.status === 429) cooldown.set(model, Date.now() + 60_000);
        console.warn(`[gemini] ${model} ${res.status}`, (await res.text()).slice(0, 160));
        continue;
      }
      const data = await res.json();
      const out = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('');
      if (!out) continue;
      return JSON.parse(out) as LlmResult;
    } catch (e) {
      console.warn(`[gemini] ${model} 실패`, (e as Error).message);
    }
  }
  return null;
}


/** 오늘·이번 주말·다음주 주말 날짜 문자열 */
export function dateContext(today = new Date()) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const sat = new Date(today);
  sat.setDate(today.getDate() + ((6 - today.getDay() + 7) % 7));
  const nextSat = new Date(sat);
  nextSat.setDate(sat.getDate() + 7);
  return `오늘: ${iso(today)}(${days[today.getDay()]}) · 이번 주말 토요일: ${iso(sat)} · 다음주 주말 토요일: ${iso(nextSat)}`;
}

export const AGENT_MODELS: { name: string; thinking?: string }[] = [
  ...(process.env.GEMINI_MODEL ? [{ name: process.env.GEMINI_MODEL }] : []),
  { name: 'gemini-3.5-flash', thinking: 'low' },
  // 무료 등급 한도는 모델마다 따로라, 가벼운 모델 여러 개로 나눠 써요
  { name: 'gemini-3.5-flash-lite' },
  { name: 'gemini-3.1-flash-lite' },
  { name: 'gemini-flash-lite-latest' },
];

/** generateContent 한 번 호출. 실패하면 null. 429면 그 모델을 1분 쉬게 해요. */
export async function generate(model: { name: string; thinking?: string }, body: Record<string, unknown>, timeoutMs = model.thinking ? 8000 : 12000) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if ((cooldown.get(model.name) ?? 0) > Date.now()) return null;
  const generationConfig = { ...((body.generationConfig as object) || {}), ...(model.thinking ? { thinkingConfig: { thinkingLevel: model.thinking } } : {}) };
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model.name}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ ...body, generationConfig }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      if (res.status === 429) cooldown.set(model.name, Date.now() + 60_000);
      console.warn(`[gemini] ${model.name} ${res.status}`, (await res.text()).slice(0, 160));
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`[gemini] ${model.name} 실패`, (e as Error).message);
    return null;
  }
}
