export interface Example {
  tag: string;
  text: string;
}

export interface ExampleGroup {
  name: string; // 오토캠핑 · 글램핑 · 카라반
  hint: string; // 탭 아래 보이는 한 줄 설명 (문장)
  items: Example[];
}

/** 빈자리 자동 확인 예시. 자동 확인은 캠핑톡 공공 캠핑장(평택 소풍정원 등)만 돼서 지역을 태그에 밝혀 둬요 */
export const AVAILABILITY_EXAMPLE: Example = { tag: '빈자리 확인 (평택)', text: '이번 주말 평택 쪽 캠핑장 찾아서 빈자리 있는지까지 확인해 줘' };

/** 첫 화면 예시: 유형별로 나눠서, 유형마다 많이 찾는 조건을 보여 줘요 */
export const EXAMPLE_GROUPS: ExampleGroup[] = [
  {
    name: '오토캠핑',
    hint: '내 텐트를 치는 사이트예요. 차를 사이트 옆에 댈 수 있어요.',
    items: [
      AVAILABILITY_EXAMPLE,
      { tag: '개인화장실', text: '다음주 주말 경기도 오토캠핑장, 텐트 사이트에 개인화장실 꼭 있어야 해' },
      { tag: '아이와 함께', text: '우리 집에서 1시간 30분 안쪽, 아이 둘이랑 갈 건데 놀이터랑 물놀이장 있는 오토캠핑장' },
      { tag: '겨울 · 난로 대여', text: '다음주 주말 오토캠핑, 난로 대여되고 전기는 꼭 있어야 해. 서울에서 2시간 이내' },
      { tag: '힐링', text: '양평 숲속 오토캠핑장, 조용하고 사이트 간격 넓은 곳이면 좋겠어' },
    ],
  },
  {
    name: '글램핑',
    hint: '텐트와 침구·장비가 미리 갖춰진 객실이에요.',
    items: [
      { tag: '계곡', text: '이번 주말 가평 계곡 옆 글램핑, 4명이고 와이파이는 꼭 있어야 해' },
      { tag: '반려견', text: '다음주 주말 강원도 바다 근처 글램핑, 7kg 푸들 데려가고 바비큐 되는 곳' },
      { tag: '아이 체험', text: '포천 글램핑, 아이 체험 프로그램 있고 매점도 있으면 좋겠어' },
    ],
  },
  {
    name: '카라반',
    hint: '설치된 카라반에서 자거나, 내 캠핑카를 가져가는 곳이에요.',
    items: [
      { tag: '바다', text: '양양 바다 근처 카라반, 5kg 소형견 데려갈 수 있는 곳' },
      { tag: '개인화장실 · 불멍', text: '카라반인데 개인화장실 있고 불멍 되는 곳, 천안에서 1시간 30분 이내' },
      { tag: '내 캠핑카', text: '캠핑카 들어갈 수 있는 파쇄석 사이트, 천안에서 2시간 이내, 대형견도 같이 가' },
    ],
  },
];

export const EXAMPLE_CARDS: Example[] = EXAMPLE_GROUPS.flatMap((g) => g.items);
export const EXAMPLES = EXAMPLE_CARDS.map((e) => e.text);

/** 펜션·민박 첫 화면 예시 */
export const PENSION_EXAMPLE_GROUPS: ExampleGroup[] = [
  {
    name: '가족·단체',
    hint: '인원과 가격은 관광공사에 객실 정보가 있는 곳만 확인돼요.',
    items: [
      { tag: '독채 · 바비큐', text: '가평 독채 펜션, 6명이고 바비큐 되는 곳. 1박 30만 원 이하면 좋겠어' },
      { tag: '수영장', text: '다음주 주말 강원도 펜션, 아이 둘이랑 4명이고 수영장 있는 곳' },
      { tag: '키즈 펜션', text: '경기도 키즈 펜션, 아이 둘이랑 4명이고 키즈풀이나 놀이방 있는 곳' },
      { tag: '우리 집 2시간 · 취사', text: '우리 집에서 2시간 안쪽, 8명 묵을 수 있고 객실에서 취사 되는 펜션' },
    ],
  },
  {
    name: '커플·힐링',
    hint: '객실이 적은 곳은 조용함을 높게 쳐요.',
    items: [
      { tag: '스파 · 오션뷰', text: '양양 쪽 오션뷰 펜션, 스파나 자쿠지 있으면 좋겠어' },
      { tag: '조용한 독채', text: '서울에서 1시간 30분 이내 조용한 독채 펜션, 2명' },
      { tag: '우리 집 1시간', text: '이번 주말 우리 집에서 1시간 이내, 둘이 갈 스파 있는 펜션. 1박 20만 원 이하' },
      { tag: '관광펜션', text: '경주 관광펜션으로 지정된 곳 중에 바비큐 되는 곳' },
    ],
  },
  {
    name: '반려견',
    hint: '펜션은 반려견 정보가 소개글에만 있어서 대부분 추정이에요.',
    items: [
      { tag: '애견 펜션', text: '태안 펜션, 강아지 데려갈 수 있고 바비큐 되는 곳' },
      { tag: '소형견 · 독채', text: '홍천 독채 펜션, 5kg 강아지랑 2명' },
      { tag: '우리 집 2시간', text: '우리 집에서 2시간 안쪽 애견 펜션, 3명이랑 8kg 강아지. 바비큐 되면 좋겠어' },
    ],
  },
];
export const PENSION_EXAMPLES = PENSION_EXAMPLE_GROUPS.flatMap((g) => g.items).map((e) => e.text);
