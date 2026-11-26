/** 반려견 크기: small 5kg 이하, mid 5~10kg(캠핑장마다 소형견 기준이 달라 애매한 구간), big 10kg 초과·중대형 */
export type PetSize = 'small' | 'mid' | 'big';

import type { Availability } from './availability';

/** likely = 직접 확인은 아니지만 데이터 근거로 추정 */
export type Verdict = 'yes' | 'likely' | 'no' | 'unknown';

/** 확인 방법: filter = 기본 정보(API)로 바로 판정, detail = 상세 페이지 판독 필요, judge = 후기·사진 등으로 판단 필요 */
export type CondKind = 'filter' | 'detail' | 'judge';

export interface Cond {
  key: string; // 판정 규칙 식별자 (예: sbrs:전기, lct:계곡, power:2)
  label: string; // 화면에 보이는 이름
  kind: CondKind;
  must: boolean; // true = 필수(못 맞추면 제외), false = 선호(순위에만 반영)
  fromProfile?: boolean; // 내 정보에서 기본으로 들어온 조건
}

export interface AgentState {
  origin?: string;
  originCoords?: [number, number]; // 우리 집·현재 위치처럼 도시 표에 없는 출발지
  maxMinutes?: number;
  regions: string[]; // 시·군·구 또는 시·도 이름
  checkIn?: string; // YYYY-MM-DD
  nights?: number;
  dateLabel?: string;
  season?: '봄' | '여름' | '가을' | '겨울';
  people?: number;
  pet?: boolean;
  kids?: boolean; // 아이와 함께 감 → 노키즈존은 빼요
  petSize?: PetSize;
  petKg?: number; // 사용자가 말한 반려견 몸무게
  conds: Cond[];
  lastIds?: string[]; // 직전 결과의 contentId (1번, 2번 참조용)
  excludeIds?: string[]; // 결과에서 뺄 곳 (비슷한 곳 찾기의 기준 캠핑장)
  similarTo?: string; // 비슷한 곳 찾기의 기준 캠핑장 이름
  category?: 'camp' | 'pension'; // 지금 찾는 숙소 종류 (없으면 캠핑장)
  maxPrice?: number; // 1박 최대 가격(원). 펜션만
  focusId?: string; // 방금 상세를 본 캠핑장 ("반려동물 가능해?" 같은 후속 질문의 대상)
  pendingAvailability?: number; // 빈자리 확인 중 날짜를 물어본 숙소 번호 (다음 답이 날짜면 이어서 확인)
}

export interface Stage {
  label: string;
  count: number;
  note?: string;
}

export interface Column {
  key: string;
  label: string;
  kind: CondKind;
  must: boolean;
  fromProfile?: boolean; // 내 정보에서 들어온 선호 조건
}

export interface Row {
  id: string;
  rank: number;
  name: string;
  area: string;
  type: string;
  minutes?: number;
  inRegion: boolean;
  cells: Record<string, { v: Verdict; text: string }>;
  reserve: { mode: string; url?: string; dead?: boolean }; // dead: 주소가 열리지 않음(도메인 없음 등)
  liveCheck?: boolean; // 빈자리 자동 확인 가능한 예약처
  extraSource?: string; // 고캠핑 외 출처에서 추가된 곳이면 출처 이름
  image?: string;
  asOf?: string; // 고캠핑 정보 갱신일 (YYYY-MM)
  stale?: boolean; // 갱신한 지 1년이 넘음 → 예약처·이름이 바뀌었을 수 있음
  place?: { name: string; phone?: string; url: string; renamed: boolean }; // 카카오맵의 지금 정보
  google?: { website?: string; rating?: number; reviews?: number; phone?: string; mapsUrl?: string }; // 구글에 등록된 정보 (펜션)
  naver?: { link?: string; linkKind?: string; phone?: string };
  pending?: boolean; // 링크·평점·카카오맵 정보를 아직 찾는 중 (화면이 /api/enrich로 뒤에 채워요) // 네이버 지역 검색에 등록된 링크 (구글에 홈페이지가 없을 때)
}

export interface Dropped {
  id: string;
  name: string;
  reason: string;
}

export interface Relax {
  label: string; // 버튼 문구 (그대로 전송)
  gain: number; // 늘어나는 곳 수
}

export interface DetailCard {
  id: string;
  name: string;
  intro: string;
  address: string;
  facts: { label: string; value: string }[];
  links: { label: string; url: string }[];
  image?: string;
  images?: string[]; // 사진 여러 장 (공공데이터 캠핑장 사진 목록)
}

export interface AgentReply {
  kind: 'ask' | 'result' | 'detail' | 'message';
  text: string;
  state: AgentState;
  chips: string[];
  understood?: { label: string; tone: 'must' | 'pref' | 'info'; profile?: boolean }[];
  stages?: Stage[];
  columns?: Column[];
  rows?: Row[];
  total?: number;
  relax?: Relax[];
  detail?: DetailCard;
  draft?: string;
  availability?: Availability;
  availabilities?: Availability[]; // 여러 곳을 한꺼번에 확인했을 때
  extras?: ExtraPlace[]; // 고캠핑에 없는 캠핑장 (카카오 장소 검색)
  dropped?: Dropped[]; // 이전 결과에 있었는데 이번에 빠진 곳
  engine?: 'agent' | 'gemini' | 'rules';
  trace?: TraceStep[];
}

/** Gemini 에이전트가 이번 답을 만들려고 실제로 부른 도구들 */
export interface TraceStep {
  tool: string;
  label: string;
  reason?: string;
  result?: string;
}

/** 브라우저가 알려 주는 개인 위치 (서버에 저장하지 않아요) */
export interface Places {
  home?: { lat: number; lng: number; label: string };
  current?: { lat: number; lng: number; label?: string };
}

/** 고캠핑에 없어서 조건 확인이 안 된 캠핑장 */
export interface ExtraPlace {
  id: string;
  name: string;
  address: string;
  phone?: string;
  url: string;
  category: string;
  minutes?: number;
}
