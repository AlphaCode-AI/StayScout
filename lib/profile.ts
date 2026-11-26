/**
 * 내 정보: 자주 같이 가는 인원, 반려견 크기, 늘 원하는 조건.
 * 브라우저에만 저장하고, 검색할 때 같이 보내요. 새 대화의 첫 검색에만 "기본값"으로 깔아 두고,
 * 사용자가 그 대화에서 직접 말한 내용이 항상 우선이에요.
 */
import type { AgentState, Cond, CondKind } from './types';

export interface Profile {
  adults?: number;
  kids?: number;
  petSize?: 'small' | 'big'; // 반려견과 갈 때 크기 (매번 되묻지 않게)
  prefs?: string[]; // 늘 원하는 조건 (선호로 반영)
}

/** 내 정보에서 고를 수 있는 조건 */
export const PROFILE_PREFS: { key: string; label: string; kind: CondKind; group: string }[] = [
  { key: 'induty:자동차야영장', label: '오토캠핑', kind: 'filter', group: '숙소 유형' },
  { key: 'induty:글램핑', label: '글램핑', kind: 'filter', group: '숙소 유형' },
  { key: 'induty:카라반', label: '카라반', kind: 'filter', group: '숙소 유형' },
  { key: 'toilet', label: '개인화장실', kind: 'detail', group: '시설' },
  { key: 'sbrs:전기', label: '전기', kind: 'filter', group: '시설' },
  { key: 'sbrs:온수', label: '온수', kind: 'filter', group: '시설' },
  { key: 'sbrs:무선인터넷', label: '와이파이', kind: 'filter', group: '시설' },
  { key: 'plenty:샤워실', label: '샤워실 넉넉', kind: 'filter', group: '시설' },
  { key: 'brazier', label: '개별 화로대(불멍)', kind: 'filter', group: '시설' },
  { key: 'sbrs:놀이터', label: '놀이터', kind: 'filter', group: '시설' },
  { key: 'etc:수영장', label: '수영장', kind: 'filter', group: '시설' },
  { key: 'tarp', label: '설치된 타프', kind: 'filter', group: '시설' },
  { key: 'etc:스파', label: '스파·자쿠지', kind: 'filter', group: '시설' },
  { key: 'near:낚시', label: '낚시', kind: 'filter', group: '주변·레저' },
  { key: 'near:수상레저', label: '수상레저', kind: 'filter', group: '주변·레저' },
  { key: 'near:해수욕', label: '해수욕', kind: 'filter', group: '주변·레저' },
  { key: 'forest', label: '자연휴양림', kind: 'filter', group: '주변·레저' },
  { key: 'oceanview', label: '오션뷰', kind: 'filter', group: '분위기' },
  { key: 'new', label: '새로 연 곳', kind: 'filter', group: '분위기' },
  { key: 'online', label: '온라인 예약', kind: 'filter', group: '시설' },
  { key: 'judge:조용함', label: '조용함', kind: 'judge', group: '분위기' },
  { key: 'judge:사이트 간격 넓음', label: '사이트 간격 넓음', kind: 'judge', group: '분위기' },
  { key: 'nokids', label: '노키즈존', kind: 'filter', group: '분위기' },
  { key: 'nopet', label: '반려동물 없는 곳', kind: 'filter', group: '분위기' },
];

/** 새 대화(아직 아무 조건도 없을 때)에 내 정보를 기본값으로 깔아요 */
export function applyProfile(state: AgentState, p?: Profile): AgentState {
  if (!p) return state;
  const fresh = !state.conds.length && !state.regions.length && !state.lastIds?.length && !state.origin;
  const next: AgentState = { ...state, conds: [...state.conds] };
  // 반려견 크기는 대화 중 언제든 "강아지랑"이라고만 해도 쓰여요 (되묻지 않게)
  if (p.petSize && !next.petSize) next.petSize = p.petSize;
  if (!fresh) return next;
  const people = (p.adults ?? 0) + (p.kids ?? 0);
  if (people && !next.people) next.people = people;
  if (p.kids && !next.kids) next.kids = true;
  for (const key of p.prefs ?? []) {
    const o = PROFILE_PREFS.find((x) => x.key === key);
    if (o && !next.conds.some((c) => c.key === key)) next.conds.push({ key, label: o.label, kind: o.kind, must: false, fromProfile: true } as Cond);
  }
  return next;
}
