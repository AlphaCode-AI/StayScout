/**
 * Gemini 에이전트 루프.
 * Gemini에게 도구(조건 갱신, 탐색, 조건 완화, 상세, 문의, 되묻기, 답변)를 주고,
 * 어떤 도구를 어떤 순서로 부를지 Gemini가 정해요. 실패하면 null → 기본 파이프라인으로 넘어가요.
 */
import {
  markPending,
  availabilityOf,
  chipsFor,
  estimateNote,
  extrasFor,
  describe,
  detailWithPlace,
  lookupCampsByName,
  campByRank,
  typesOf,
  similarState,
  draftOf,
  missingInfo,
  relaxOf,
  resultText,
  searchOf,
  regions,
} from './agent';
import { campById, estimateMinutes, evalCond, loadCamps, originCoords, type Camp } from './data';
import { driveRoute } from './route';
import { nameCore } from './names';
import { applyPlaces, mergeDelta } from './interpret';
import { AGENT_MODELS, CATALOG, SCHEMA, dateContext, generate, type LlmResult } from './llm';
import { parse } from './parse';
import type { Availability } from './availability';
import type { AgentReply, AgentState, DetailCard, ExtraPlace, Places, Relax, TraceStep } from './types';

const MAX_STEPS = 7;

const reason = { type: 'STRING', description: '이 도구를 지금 부르는 이유 한 줄 (사용자 화면에 보여요)' };

// update_conditions 인자는 조건 해석 스키마에서 intent/refIndex를 뺀 것
const { intent: _i, refIndex: _r, ...deltaProps } = (SCHEMA as { properties: Record<string, unknown> }).properties;

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'update_conditions',
        description: '사용자의 새 말에서 새로 나왔거나 바뀐 조건만 반영해요. 바뀌지 않은 필드는 넣지 마세요.',
        parameters: { type: 'OBJECT', properties: { reason, ...deltaProps } },
      },
      {
        name: 'reset_conditions',
        description: '사용자가 처음부터 다시 찾자고 할 때 모든 조건을 지워요.',
        parameters: { type: 'OBJECT', properties: { reason } },
      },
      {
        name: 'search_camps',
        description:
          '현재 조건으로 공공데이터(캠핑장, 또는 category가 pension이면 펜션·민박)에서 숙소를 찾아요. 결과 수, 단계별 남은 수, 상위 5곳 요약을 돌려줘요. 결과를 바꾸는 정보가 빠졌으면 need_info와 함께 물어볼 질문과 버튼 문구를 돌려줘요.',
        parameters: { type: 'OBJECT', properties: { reason } },
      },
      {
        name: 'suggest_relaxations',
        description: '결과가 없거나 적을 때, 어떤 조건을 풀면 몇 곳이 늘어나는지 계산해요.',
        parameters: { type: 'OBJECT', properties: { reason } },
      },
      {
        name: 'get_camp',
        description: '숙소 하나의 상세 정보(사진·시설·링크)와 자주 묻는 조건 판정을 가져와서 화면 오른쪽에 상세로 보여 줘요. 결과 표에 없는 곳도 이름으로 전국에서 찾아요. 비슷한 이름이 여러 곳이면 후보 목록을 돌려줘요.',
        parameters: { type: 'OBJECT', properties: { reason, target: { type: 'STRING', description: '어느 숙소인지: 결과 표 번호("3"), 방금 본 곳("current"), 또는 숙소 이름(지역을 알면 "이름 (시군)")' } }, required: ['target'] },
      },
      {
        name: 'check_camp',
        description: '특정 숙소 하나에 대해 사용자가 물은 조건(예: 반려동물, 개인화장실, 전기, 바비큐)이 되는지 판정해요. 검색 조건은 바꾸지 않아요. "방금 본 곳 반려동물 돼?" 같은 질문에 써요.',
        parameters: {
          type: 'OBJECT',
          properties: {
            reason,
            target: { type: 'STRING', description: '어느 숙소인지: 결과 표 번호("3"), 방금 본 곳("current"), 또는 숙소 이름(지역을 알면 "이름 (시군)")' },
            conditions: { type: 'ARRAY', items: { type: 'STRING' }, description: '사용자가 물은 조건을 사용자 말 그대로 짧게 (예: "반려동물", "개인화장실", "7kg 강아지")' },
          },
          required: ['target', 'conditions'],
        },
      },
      {
        name: 'check_route',
        description:
          '출발지에서 숙소 하나까지 자동차로 실제 얼마나 걸리는지 카카오내비 길찾기로 재요. "얼마나 걸려?", "주말 점심에도?", "몇 시에 출발하면?" 같은 이동 시간 질문에는 직접 짐작하지 말고 반드시 이 도구를 써. 검색 조건은 바꾸지 않아요.',
        parameters: {
          type: 'OBJECT',
          properties: {
            reason,
            target: { type: 'STRING', description: '어느 숙소인지: 결과 표 번호("3"), 방금 본 곳("current"), 또는 숙소 이름' },
            date: { type: 'STRING', description: '출발 날짜 YYYY-MM-DD (오늘 날짜 기준으로 계산해서). 말이 없으면 지금 조건의 체크인 날짜, 그것도 없으면 비워' },
            time: { type: 'STRING', description: '출발 시각 HH:MM 24시간 (예: "점심" 12:00, "아침" 09:00, "저녁" 18:00). 말이 없으면 비워' },
          },
          required: ['target'],
        },
      },
      {
        name: 'find_similar',
        description: '기준 숙소와 비슷한 곳(유형·개인화장실·입지·화로대·규모가 비슷하고 1시간 거리 안)을 찾아 결과 표로 보여 줘요. 검색 조건이 이 기준으로 바뀌어요.',
        parameters: { type: 'OBJECT', properties: { reason, target: { type: 'STRING', description: '어느 숙소인지: 결과 표 번호("3"), 방금 본 곳("current"), 또는 숙소 이름(지역을 알면 "이름 (시군)")' } }, required: ['target'] },
      },
      {
        name: 'check_availability',
        description:
          '숙소 하나의 실제 빈자리를 확인해요. 결과 표 번호(rank)나 숙소 이름·방금 본 곳(target) 중 하나로 지정해요. 지금은 캠핑톡 공공 캠핑장만 자동 확인이 되고(검색 결과의 빈자리확인가능=true), 나머지는 unsupported를 돌려줘요. 날짜가 없으면 need_date를 돌려줘요. 확인할 수 있는지 짐작하지 말고 먼저 불러 봐.',
        parameters: { type: 'OBJECT', properties: { reason, rank: { type: 'INTEGER' }, target: { type: 'STRING', description: '결과 표에 없는 숙소면 이름, 방금 본 곳이면 "current"' } } },
      },
      {
        name: 'draft_inquiry',
        description: '직전 결과 표의 N번 숙소에 보낼 문의 메시지 초안을 써요. 확인이 필요한 조건만 물어봐요.',
        parameters: { type: 'OBJECT', properties: { reason, rank: { type: 'INTEGER' } }, required: ['rank'] },
      },
      {
        name: 'ask_user',
        description: '결과를 바꾸는 정보가 빠졌을 때만 사용자에게 물어요. 이번 턴을 끝내요.',
        parameters: {
          type: 'OBJECT',
          properties: {
            question: { type: 'STRING' },
            options: { type: 'ARRAY', items: { type: 'STRING' }, description: '사용자가 눌러서 그대로 보낼 짧은 답 2~5개' },
          },
          required: ['question'],
        },
      },
      {
        name: 'finish',
        description: '사용자에게 답하고 이번 턴을 끝내요.',
        parameters: {
          type: 'OBJECT',
          properties: {
            message: { type: 'STRING', description: '무엇을 찾았고 왜 이렇게 골랐는지 2~3문장. 도구 결과에 있는 숫자와 이름만 써요.' },
            suggestions: { type: 'ARRAY', items: { type: 'STRING' }, description: '다음에 누를 만한 요청 3~5개. 사용자가 그대로 보낼 짧은 문장.' },
          },
          required: ['message'],
        },
      },
    ],
  },
];

function systemPrompt(prev: AgentState) {
  const current = {
    origin: prev.origin,
    maxMinutes: prev.maxMinutes,
    regions: prev.regions,
    dateLabel: prev.dateLabel,
    people: prev.people,
    category: prev.category ?? "camp",
    maxPrice: prev.maxPrice,
    pet: prev.pet,
    petSize: prev.petSize,
    conditions: prev.conds.map((c) => ({ key: c.key, label: c.label, must: c.must })),
    lastResultCount: prev.lastIds?.length ?? 0,
    방금_본_캠핑장: campById(prev.focusId)?.facltNm,
  };
  return `너는 StayScout, 사용자가 말한 조건에 맞는 "갈 수 있는 숙소"(캠핑장, 펜션·민박)를 찾아 주는 에이전트야.
지금 찾는 종류: ${prev.category === 'pension' ? '펜션·민박' : '캠핑장'}. 사용자가 펜션·독채·풀빌라·민박을 말하면 update_conditions에 category "pension", 캠핑·글램핑·카라반을 말하면 "camp"를 넣어. 펜션은 객실 인원(people)과 1박 가격(maxPrice)도 조건이 돼. 펜션에는 캠핑 전용 조건(텐트, 화로대, 전기 등)을 넣지 마.
목표: 사용자의 목표를 이해하고, 도구로 실제 데이터를 확인해서, 근거와 함께 가장 잘 맞는 곳을 제시해.

${dateContext()}

[지금까지의 조건]
${JSON.stringify(current)}

[일하는 방식]
1. 사용자의 말에 조건이 새로 나오거나 바뀌면 먼저 update_conditions를 불러. 바뀐 것만 넣어.
2. 그다음 search_camps로 찾아. need_info가 오면 그 question과 options를 그대로 ask_user로 물어봐.
3. 결과가 3곳 미만이면 suggest_relaxations를 부르고, 무엇을 풀면 몇 곳이 늘어나는지 finish에서 안내해.
4. 특정 숙소 하나(캠핑장·펜션)에 대한 말이면 검색하지 마. 그곳까지 걸리는 시간을 물으면 check_route를 불러(이어지는 "그 시간에도?", "점심에도?"도 같아). 이름으로 못 찾았으면 비슷한 곳을 검색하지 말고 못 찾았다고 답해(사용자가 대신 찾아 달라고 한 경우만 검색). 정보·상세를 원하면 get_camp, 그곳에 어떤 조건이 되는지 물으면 check_camp, 비슷한 곳을 원하면 find_similar를 불러. target은 결과 표 번호, 이름, 또는 방금_본_캠핑장을 가리킬 때 "current"야. "N번에 문의/물어봐"는 draft_inquiry, "N번 빈자리/예약 가능?"은 check_availability를 부른 뒤 finish.
   - finish의 suggestions에 "N번 빈자리 확인해 줘"는 빈자리확인가능=true인 곳에만 넣어. 그런 곳이 없으면 빈자리 관련 제안을 넣지 마.
   - 사용자가 번호 없이 "빈자리까지 확인해 줘"라고 하면, 검색 결과 중 빈자리확인가능=true인 곳을 골라 check_availability를 불러. 그런 곳이 없으면 자동 확인이 안 된다고 정직하게 말해.
   - "그럼 12월 둘째주는 빈자리 있어?"처럼 날짜만 바꿔 빈자리를 다시 물으면, update_conditions로 날짜만 바꾸고 search_camps 뒤에 빈자리확인가능=true인 곳마다 check_availability를 불러. 자동 확인되는 곳이 하나라도 있으면 "빈자리를 자동으로 확인할 수 없다"고 뭉뚱그려 말하지 말고, 확인한 곳과 확인 못 하는 곳을 나눠서 말해.
   - 빈자리는 check_availability가 status ok를 돌려준 경우에만 "남아 있다/없다"고 말해. unsupported면 "자동으로 확인할 수 없는 예약처"라고 말하고 절대 추측하지 마.
5. "처음부터 다시"는 reset_conditions 후 finish로 어떤 조건을 원하는지 물어.
6. 반드시 ask_user 또는 finish로 끝내. 한 번에 도구 하나씩 불러.

[조건 다루기]
- must: "꼭, 필요, 필수, 있어야" 또는 별말 없으면 true. "있으면 좋겠어, 가능하면, 선호, ~면 좋겠어"는 false.

[답변 규칙]
- 한국어 해요체(~해요), 짧고 구체적으로. 도구 결과에 없는 사실·숫자·장소를 지어내지 마.
- 와이파이·전기·놀이터·반려견·입지 같은 조건은 공공데이터로 이미 확인된 거야. "확인 필요"라고 말해도 되는 건 search_camps 결과의 확인필요 목록에 있는 조건뿐이야.
- "조용함", "사이트 간격" 같은 판단형 조건은 사이트 간 거리, 사이트 수, 입지, 소개글로 추정해. 추정_근거가 있으면 "추정"이라고 밝히고 근거를 짧게 말해. 근거가 없으면 "확인 필요"라고 정직하게 말해.
- 사용자가 가장 강조한 조건(예: 조용함)에 대해 답변의 첫 문장에서 직접 답해.
- 방금_본_캠핑장이 있고 사용자가 숙소 이름 없이 그곳의 조건을 묻는 말(어떤 말투든: "반려동물 가능해?", "화장실 있는지 확인해줘", "전기는?")은 그 캠핑장에 대한 질문이야. update_conditions나 search_camps를 부르지 말고 check_camp(target "current")로 답해.
- check_camp나 get_camp로 조건을 답할 때는 판정으로 첫 문장에서 바로 답해. 추정이면 근거 문구와 함께 '추정'이라고, 확인 필요면 정직하게 모른다고 하고 전화 확인을 권해. 사용자가 이름을 정정하면(예: '포천에 있는 거') 지역을 붙인 이름으로 다시 불러.
- get_camp 결과의 안내(링크가 열리지 않음, 전화번호 자릿수 오류, 카카오맵 이름 다름, 카카오맵 미등록)는 답변에서 빠뜨리지 말고 짧게 전해 줘.
- top5에 예약_링크가 '열리지 않음'이면 그곳을 소개할 때 "등록된 링크가 열리지 않는다"고 한 줄 알려 줘.
- top5에 카카오맵_지금_이름이 있으면 "등록된 이름과 카카오맵 이름이 달라 예약 링크가 옛 정보일 수 있다"고 그곳에 한 줄로 알려 줘. 정보_기준이 있는 곳을 1위로 소개할 때도 "예약 전 전화 확인"을 덧붙여.
- 조건_미확인_추가가 있으면 "카카오맵에서 N곳을 더 찾았지만 시설 정보가 없어 순위에는 넣지 않았다"고 한 줄로만 알려 줘. 그곳들을 추천 순위에 넣지 마.
- 사용자는 '고캠핑'이 뭔지 모를 수 있어. 답변에 '고캠핑'이라는 이름을 쓰지 말고 필요하면 '공공 캠핑장 정보'라고 해.
- 몇 곳 찾았는지는 반드시 조건에_맞는_곳 숫자로 말해. 후보_전체_확인필요_포함은 확인 못 한 곳이 섞인 수라서 "조건에 맞는 N곳"이라고 쓰면 안 돼. 두 수가 다르면 "후보 N곳 중 M곳이 조건에 맞아요"처럼 둘 다 말해. 1위는 반드시 top5의 rank 1이야.
- top5의 유형에 "텐트 사이트 없음"이 있으면 그곳은 카라반·글램핑 객실만 있는 곳이야. 소개할 때 "텐트는 못 치고 카라반(글램핑) 숙박만 되는 곳"이라고 분명히 말해.
- finish의 message는 채팅에 그대로 보이는 글이야. 3문장 이내로 짧게: 몇 곳 찾았는지, 1위와 고른 이유, 꼭 알아야 할 주의점 하나. 결과 표는 화면 오른쪽에 따로 보이니까 2위 이하를 나열하거나 표 내용을 반복하지 마.
- finish의 suggestions 예: "1번 자세히 보기", "2번 숙소에 문의 메시지 써 줘", "온라인 예약 되는 곳만", 조건 완화 문구(도구가 준 label 그대로).

[update_conditions의 조건 key 목록]
${CATALOG}
- 날짜·인원·지역·출발지·반려견·이동 시간은 conditions가 아니라 각자의 필드에 넣어. "우리 집", "현재 위치"는 origin에 넣지 마.
- "이번 주말", "다음주 주말"은 위 날짜를 그대로 checkIn에 써.`;
}

/** 한 캠핑장에 대해 자주 묻는 조건과 지금 대화의 조건을 판정해서 Gemini에게 넘겨요 (질문에 바로 답할 수 있게) */
const COMMON_CHECKS: [string, string][] = [
  ['toilet', '개인화장실'],
  ['sbrs:전기', '전기'],
  ['sbrs:온수', '온수'],
  ['sbrs:무선인터넷', '와이파이'],
  ['judge:바비큐', '바비큐'],
  ['brazier', '개별 화로대'],
  ['lend:난방기구', '난방기구 대여'],
  ['sbrs:놀이터', '놀이터'],
];
const PENSION_CHECKS: [string, string][] = [
  ['detached', '독채'],
  ['judge:바비큐', '바비큐'],
  ['etc:수영장', '수영장'],
  ['etc:스파', '스파·자쿠지'],
  ['cook', '객실 취사'],
  ['judge:조용함', '조용함'],
  ['tourpension', '관광펜션 지정'],
];
function verdictsFor(camp: Camp, state: AgentState) {
  const V = { yes: '확인됨', likely: '추정', no: '아님', unknown: '확인 필요' } as const;
  const keys = new Map<string, string>(camp.kind === 'pension' ? PENSION_CHECKS : COMMON_CHECKS);
  for (const c of state.conds) keys.set(c.key, c.label);
  const out: Record<string, string> = {};
  if (state.pet) {
    const p = evalCond('pet', camp, state.petSize, typesOf(state));
    out['반려견'] = `${V[p.v]} · ${p.text}`;
  }
  for (const [k, label] of keys) {
    const r = evalCond(k, camp, state.petSize, typesOf(state));
    out[label] = `${V[r.v]} · ${r.text}`;
  }
  return out;
}

/** target("3", "current", 이름)을 캠핑장 하나로 바꿔요 */
function resolveCamp(target: string, state: AgentState): { camp: Camp; rank: number } | { error: string; 비슷한_이름?: string[]; 안내?: string } | { 후보: string[]; 안내: string } {
  const t = target.trim();
  const ids = state.lastIds ?? [];
  let camp: Camp | undefined;
  if (/^(current|방금|이곳|여기)$/i.test(t)) camp = campById(state.focusId);
  else if (/^\d+$/.test(t)) camp = campByRank(state, Number(t));
  else {
    const found = lookupCampsByName(t);
    if (found.length > 1) return { 후보: found.slice(0, 8).map((c) => `${c.facltNm} (${c.sigunguNm})`), 안내: '이름이 비슷한 곳이 여러 곳이에요. 사용자에게 어느 곳인지 물어봐.' };
    camp = found[0];
  }
  if (!camp) {
    if (/^\d+$/.test(t)) return { error: '그 번호의 숙소가 없어요.' };
    if (/^(current|방금|이곳|여기)$/i.test(t)) return { error: '방금 본 숙소가 없어요.' };
    const near = similarNames(t);
    return {
      error: '그 이름의 숙소를 전국 공공데이터에서 찾지 못했어요.',
      ...(near.length ? { 비슷한_이름: near } : {}),
      안내:
        '조건 검색(search_camps)으로 대신 찾지 말고, 공공데이터에 없다고 답해. 신고 이름이 다르거나(숙박업으로 신고, 이름 변경) 신고되지 않은 곳일 수 있다고 짧게 덧붙이고, 비슷한_이름이 있으면 그중에 있는지 물어봐.',
    };
  }
  return { camp, rank: ids.indexOf(camp.contentId) + 1 };
}

/** 이름으로 못 찾았을 때 보여 줄 비슷한 이름: 3글자 이상 겹치거나, 이름 조각(띄어쓰기·& 기준)이 모두 들어 있는 곳 */
function similarNames(target: string) {
  const t = nameCore(target);
  const parts = target.split(/[\s&+,·()]+/).map(nameCore).filter((x) => x.length >= 2);
  if (t.length < 3 && parts.length < 2) return [];
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) grams.add(t.slice(i, i + 3));
  return loadCamps()
    .camps.filter((c) => {
      const n = nameCore(c.facltNm);
      return (parts.length >= 2 && parts.every((p) => n.includes(p))) || [...grams].some((g) => n.includes(g));
    })
    .slice(0, 5)
    .map((c) => `${c.facltNm} (${c.sigunguNm})`);
}

/** 사용자가 물은 조건(자연어)을 규칙 해석으로 조건 키로 바꿔서 한 캠핑장에 판정해요 */
function checkConds(camp: Camp, asked: string, state: AgentState) {
  const V = { yes: '확인됨', likely: '추정', no: '아님', unknown: '확인 필요' } as const;
  const p = parse(asked, { regions: [], conds: [] }, []);
  const out: Record<string, string> = {};
  if (p.state.pet || /반려|강아지|애견|댕댕|멍멍/.test(asked)) {
    const r = evalCond('pet', camp, p.state.petSize ?? state.petSize, typesOf(state));
    out['반려동물'] = `${V[r.v]} · ${r.text}${camp.animalCmgCl ? ` (등록 정보: ${camp.animalCmgCl})` : ''}`;
  }
  for (const c of p.state.conds) {
    const r = evalCond(c.key, camp, p.state.petSize ?? state.petSize, typesOf(state));
    out[c.label] = `${V[r.v]} · ${r.text}`;
  }
  // 규칙으로 못 알아본 조건이 있으면 자주 묻는 조건 판정을 같이 줘서 Gemini가 가장 가까운 걸로 답하게 해요
  if (!Object.keys(out).length) return { 알아본_조건_없음: asked, 참고_판정: verdictsFor(camp, state) };
  return out;
}

const LABEL: Record<string, string> = {
  update_conditions: '조건 정리',
  reset_conditions: '조건 초기화',
  search_camps: '숙소 탐색',
  suggest_relaxations: '조건 완화 계산',
  get_camp: '상세 정보 확인',
  check_camp: '조건 확인',
  check_route: '이동 시간 재기',
  find_similar: '비슷한 곳 찾기',
  draft_inquiry: '문의 메시지 작성',
  ask_user: '사용자에게 질문',
  check_availability: '빈자리 확인',
  finish: '답변',
};

type Part = { text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; thoughtSignature?: string };

export async function runAgentLoop(text: string, prev: AgentState, places?: Places): Promise<AgentReply | null> {
  if (!process.env.GEMINI_API_KEY) return null;

  const regionNames = regions();
  const originOk = (n: string) => !!originCoords(n);
  const rules = parse(text, prev, regionNames);

  let state: AgentState = structuredClone(prev);
  state.conds = [...(prev.conds || [])];
  state.regions = [...(prev.regions || [])];
  let needHome = applyPlaces(text, state, places);
  let updated = false;

  const trace: TraceStep[] = [];
  let search: ReturnType<typeof searchOf> | null = null;
  let relax: Relax[] = [];
  let detail: { text: string; detail: DetailCard } | null = null;
  let draft: { text: string; draft: string } | null = null;
  let avail: { text: string; availability?: Availability } | null = null;
  let extras: ExtraPlace[] = [];
  let checked = false; // check_camp으로 한 곳의 조건만 답했어요 (검색 조건은 그대로)
  let focus: string | undefined; // 이번 턴에 이야기한 캠핑장
  let nameMissed = false; // 이번 턴에 이름으로 찾던 숙소가 데이터에 없었어요 (그러면 조건 검색으로 넘어가지 않아요)

  const contents: { role: string; parts: unknown[] }[] = [{ role: 'user', parts: [{ text }] }];
  let model: (typeof AGENT_MODELS)[number] | null = null;

  for (let step = 0; step < MAX_STEPS; step++) {
    const body = {
      systemInstruction: { parts: [{ text: systemPrompt(prev) }] },
      contents,
      tools: TOOLS,
      toolConfig: { functionCallingConfig: { mode: 'ANY' } },
      generationConfig: { temperature: 0 },
    };
    let data: { candidates?: { content?: { role: string; parts: Part[] } }[] } | null = null;
    if (model) data = await generate(model, body);
    else {
      // 첫 호출에서 쓸 수 있는 모델을 정하고, 이번 턴은 같은 모델로 끝까지 가요.
      for (const m of AGENT_MODELS) {
        data = await generate(m, body);
        if (data) {
          model = m;
          break;
        }
      }
    }
    const content = data?.candidates?.[0]?.content;
    if (!content?.parts?.length) return null;
    contents.push(content);

    const calls = content.parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
    if (!calls.length) {
      const t = content.parts.map((p) => p.text || '').join('').trim();
      if (!t) return null;
      calls.push({ name: 'finish', args: { message: t } });
    }

    const responses: unknown[] = [];
    for (const call of calls) {
      const args = (call.args || {}) as Record<string, unknown>;
      const why = typeof args.reason === 'string' ? args.reason : undefined;

      if (call.name === 'ask_user' || call.name === 'finish') {
        trace.push({ tool: call.name, label: LABEL[call.name] });
        if (!updated && call.name === 'finish' && !search && !detail && !draft && !checked) {
          // 아무 도구도 안 쓰고 끝내려 하면 규칙 기반 보완만 하고 넘어가요
          state = mergeDelta({ intent: 'search' }, state, rules.state, regionNames, originOk, text);
        }
        return build(call.name, args);
      }

      let result: Record<string, unknown>;
      switch (call.name) {
        case 'update_conditions': {
          state = mergeDelta({ intent: 'search', ...(args as Partial<LlmResult>) }, state, rules.state, regionNames, originOk, text);
          needHome = applyPlaces(text, state, places) || needHome;
          updated = true;
          result = { 현재조건: describe(state).map((u) => `${u.tone === 'must' ? '필수' : u.tone === 'pref' ? '선호' : ''} ${u.label}`.trim()) };
          trace.push({ tool: call.name, label: LABEL[call.name], reason: why, result: `${describe(state).length}개 조건` });
          break;
        }
        case 'reset_conditions': {
          state = { regions: [], conds: [] };
          search = null;
          result = { ok: true };
          trace.push({ tool: call.name, label: LABEL[call.name], reason: why });
          break;
        }
        case 'search_camps': {
          // 특정 숙소 이름을 물었는데 데이터에 없으면, 엉뚱한 추천 후보를 뽑지 않아요 (사용자가 대신 찾아 달라고 한 경우만 예외)
          if (nameMissed && !/추천|없으면|대신|비슷한/.test(text)) {
            result = { status: 'blocked', 안내: '사용자는 특정 숙소 하나를 물었어요. 검색하지 말고 찾지 못했다고 답해.' };
            trace.push({ tool: call.name, label: LABEL[call.name], reason: why, result: '건너뜀 (이름으로 찾던 중)' });
            break;
          }
          if (!updated) {
            state = mergeDelta({ intent: 'search' }, state, rules.state, regionNames, originOk, text);
            needHome = applyPlaces(text, state, places) || needHome;
            updated = true;
          }
          const miss = missingInfo(state, needHome, places);
          if (miss) {
            result = { status: 'need_info', question: miss.text, options: miss.chips };
            trace.push({ tool: call.name, label: LABEL[call.name], reason: why, result: '정보 부족' });
            break;
          }
          search = searchOf(state);
          markPending(search.rows);
          extras = await extrasFor(state);
          result = {
            조건_미확인_추가: extras.length ? `${extras.length}곳 (카카오 장소 검색, 시설·반려견 조건 확인 안 됨)` : '없음',
            status: 'ok',
            // 숫자를 말할 때는 "조건에_맞는_곳"만 써요. 후보_전체에는 확인 못 한 곳이 섞여 있어요.
            조건에_맞는_곳: search.mustOk,
            후보_전체_확인필요_포함: search.total,
            stages: search.stages.map((s) => `${s.label}: ${s.count}곳${s.note ? ` (${s.note})` : ''}`),
            top5: search.rows.slice(0, 5).map((r) => ({
              rank: r.rank,
              name: r.name,
              area: r.area,
              유형: r.type,
              minutes: r.minutes,
              빈자리확인가능: !!r.liveCheck,
              ...(r.reserve.dead ? { 예약_링크: '열리지 않음(도메인 없음 등)' } : {}),
              ...(r.stale ? { 정보_기준: `공공 정보 ${r.asOf} 갱신 (1년 넘게 갱신 안 됨)` } : {}),
              ...(r.place?.renamed ? { 카카오맵_지금_이름: r.place.name, 전화: r.place.phone } : {}),
              추정_근거: Object.entries(r.cells)
                .filter(([, c]) => c.v === 'likely')
                .map(([k, c]) => `${state.conds.find((x) => x.key === k)?.label ?? k}: ${c.text}`),
              확인필요: Object.entries(r.cells)
                .filter(([, c]) => c.v === 'unknown')
                .map(([k]) => state.conds.find((c) => c.key === k)?.label ?? k),
            })),
            확인필요_곳수: search.unknownCount,
          };
          trace.push({ tool: call.name, label: LABEL[call.name], reason: why, result: `${search.total.toLocaleString()}곳` });
          break;
        }
        case 'suggest_relaxations': {
          relax = relaxOf(state);
          result = { options: relax.map((r) => ({ label: r.label, 늘어나는_곳수: r.gain })) };
          trace.push({ tool: call.name, label: LABEL[call.name], reason: why, result: `${relax.length}가지` });
          break;
        }
        case 'get_camp': {
          const r = resolveCamp(String(args.target ?? ''), state);
          if ('camp' in r) {
            const { camp, rank } = r;
            const d = rank > 0 ? await detailWithPlace(state, rank) : await detailWithPlace({ ...state, lastIds: [camp.contentId] }, 1);
            detail = d ? { text: rank > 0 ? d.text : d.text.replace(/^1번 /, ''), detail: d.detail } : null;
            focus = camp.contentId;
            result = d ? { name: d.detail.name, 주소: camp.addr1, 지역: `${camp.doNm} ${camp.sigunguNm}`, facts: d.detail.facts, 조건_판정: verdictsFor(camp, state), links: d.detail.links.map((l) => l.label), 안내: d.text } : { error: '상세를 만들지 못했어요.' };
          } else {
            result = r;
            if ('비슷한_이름' in r || ('error' in r && /이름/.test(r.error))) nameMissed = true;
          }
          trace.push({ tool: call.name, label: LABEL[call.name], reason: why, result: 'camp' in r ? r.camp.facltNm : '찾지 못함' });
          break;
        }
        case 'check_camp': {
          const r = resolveCamp(String(args.target ?? ''), state);
          if ('camp' in r) {
            const asked = (Array.isArray(args.conditions) ? args.conditions : []).map(String).join(', ');
            checked = true;
            focus = r.camp.contentId;
            result = { name: r.camp.facltNm, 전화: r.camp.tel || undefined, 판정: checkConds(r.camp, asked, state) };
          } else {
            result = r;
            if ('비슷한_이름' in r || ('error' in r && /이름/.test(r.error))) nameMissed = true;
          }
          trace.push({ tool: call.name, label: LABEL[call.name], reason: why, result: 'camp' in r ? r.camp.facltNm : '찾지 못함' });
          break;
        }
        case 'check_route': {
          const r = resolveCamp(String(args.target ?? ''), state);
          const from = state.originCoords ?? originCoords(state.origin);
          if (!('camp' in r)) result = r;
          else if (!from) result = { error: '출발지를 몰라요. 어디에서 출발하는지 사용자에게 물어봐(ask_user).' };
          else {
            const date = /^\d{4}-\d{2}-\d{2}$/.test(String(args.date ?? '')) ? String(args.date) : state.checkIn;
            const time = /^\d{1,2}:\d{2}$/.test(String(args.time ?? '')) ? String(args.time) : undefined;
            const route = await driveRoute(from, [Number(r.camp.mapY), Number(r.camp.mapX)], date ? `${date}${time ? `T${time}` : ''}` : undefined);
            checked = true;
            focus = r.camp.contentId;
            result = route
              ? { name: r.camp.facltNm, 출발지: state.origin ?? '우리 집', 걸리는_분: route.minutes, 거리_km: route.km, 기준: route.departure ? `${route.departure} 출발 (예상 교통)` : '지금 출발 (실시간 교통)', 안내: '이 숫자 그대로 답해. 범위로 짐작하지 마.' }
              : { error: '길찾기를 하지 못했어요 (길이 없거나 오늘 한도). 직선거리 추정만 있다고 솔직하게 말해.', 직선거리_추정_분: estimateMinutes(from, r.camp) };
          }
          trace.push({ tool: call.name, label: LABEL[call.name], reason: why, result: 'camp' in r && result && '걸리는_분' in (result as object) ? `${(result as { 걸리는_분: number }).걸리는_분}분` : undefined });
          break;
        }
        case 'find_similar': {
          const r = resolveCamp(String(args.target ?? ''), state);
          if ('camp' in r) {
            const sim = similarState(r.camp, state);
            state = sim.state;
            updated = true;
            search = searchOf(state);
            markPending(search.rows);
            extras = await extrasFor(state);
            result = {
              기준: sim.basis,
              조건에_맞는_곳: search.mustOk,
              후보_전체_확인필요_포함: search.total,
              top5: search.rows.slice(0, 5).map((x) => ({ rank: x.rank, name: x.name, area: x.area, 유형: x.type, minutes: x.minutes })),
            };
          } else {
            result = r;
            if ('비슷한_이름' in r || ('error' in r && /이름/.test(r.error))) nameMissed = true;
          }
          trace.push({ tool: call.name, label: LABEL[call.name], reason: why, result: 'camp' in r ? r.camp.facltNm : '찾지 못함' });
          break;
        }
        case 'check_availability': {
          // 번호가 없으면 이름·방금 본 곳으로 찾아서 확인해요
          let a: Awaited<ReturnType<typeof availabilityOf>> = null;
          if (Number(args.rank) > 0) a = await availabilityOf(state, Number(args.rank));
          else if (args.target) {
            const r = resolveCamp(String(args.target), state);
            if ('camp' in r) {
              a = await availabilityOf({ ...state, lastIds: [r.camp.contentId] }, 1);
              focus = r.camp.contentId;
            }
          }
          if (!a) {
            result = { error: '그 번호의 숙소가 없어요.' };
          } else if (a.needDate) {
            result = { status: 'need_date', question: a.text, options: a.chips };
          } else {
            avail = { text: a.text, availability: a.availability };
            const v = a.availability!;
            result =
              v.status === 'ok'
                ? { status: 'ok', 숙소: v.camp, 날짜: v.dateLabel, 확인시각: v.checkedAt, 출처: v.platform, 구역별_남은자리: v.zones.map((z) => ({ 구역: z.name, 남은: z.left, '1박최저가': z.minPrice })) }
                : { status: v.status, 숙소: v.camp, 예약처: v.platform, 안내: v.reason };
          }
          trace.push({
            tool: call.name,
            label: LABEL[call.name],
            reason: why,
            result: a?.availability?.status === 'ok' ? `${a.availability.totalLeft}자리` : a?.availability ? '자동 확인 불가' : undefined,
          });
          break;
        }
        case 'draft_inquiry': {
          const d = draftOf(state, Number(args.rank));
          draft = d ? { text: d.text, draft: d.draft } : null;
          result = d ? { name: d.name, 물어볼_항목: d.asks, tel: d.tel } : { error: '그 번호의 숙소가 없어요.' };
          trace.push({ tool: call.name, label: LABEL[call.name], reason: why, result: d?.name });
          break;
        }
        default:
          result = { error: `알 수 없는 도구: ${call.name}` };
      }
      responses.push({ functionResponse: { name: call.name, response: result } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return null; // 단계 제한 초과 → 기본 파이프라인

  function build(tool: string, args: Record<string, unknown>): AgentReply {
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 40) : []);
    if (tool === 'ask_user') {
      const options = strs(args.options);
      return {
        kind: 'ask',
        text: String(args.question || '조금 더 알려 주세요.'),
        state,
        understood: describe(state),
        chips: options.length ? options : missingInfo(state, needHome, places)?.chips ?? [],
        engine: 'agent',
        trace,
      };
    }
    const message = String(args.message || '');
    const suggestions = strs(args.suggestions).slice(0, 5);
    if (focus && !search) state = { ...state, focusId: focus };
    if (draft) return { kind: 'message', text: message || draft.text, state, draft: draft.draft, chips: suggestions, engine: 'agent', trace };
    if (checked && !detail && !search) return { kind: 'message', text: message || '확인했어요.', state, chips: suggestions, engine: 'agent', trace };
    if (avail && !search) return { kind: 'message', text: message || avail.text, state, availability: avail.availability, chips: suggestions, engine: 'agent', trace };
    // 검색과 상세를 한 턴에 같이 했으면 결과 표를 잃지 않게 result로 돌려주고 상세는 탭으로 붙여요
    if (detail && !search) return { kind: 'detail', text: message || detail.text, state, detail: detail.detail, chips: suggestions, engine: 'agent', trace };
    if (search) {
      return {
        kind: 'result',
        text: estimateNote(state, search.rows, message || resultText(search.total, search.rows.length, search.unknownCount, search.mustOk)),
        state,
        understood: describe(state),
        stages: search.stages,
        columns: search.columns,
        rows: search.rows,
        total: search.total,
        dropped: search.dropped,
        relax,
        availability: avail?.availability,
        detail: detail?.detail,
        extras,
        chips: suggestions.length ? suggestions : relax.length ? relax.slice(0, 3).map((r) => r.label) : chipsFor(state, search.rows, relax.length),
        engine: 'agent',
        trace,
      };
    }
    return { kind: 'message', text: message || '원하는 조건을 말씀해 주세요.', state, chips: suggestions, engine: 'agent', trace };
  }
}
