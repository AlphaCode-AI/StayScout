'use client';

import { useState } from 'react';
import { PENSION_PREFS, PROFILE_PREFS, type Profile } from '@/lib/profile';
import type { Home } from './history';

// 함께 둘 수 없는 조건: 숙소 유형은 하나만, 아이와 함께면 노키즈존, 반려견과 함께면 "반려동물 없는 곳"은 못 골라요
const SINGLE_GROUPS = ['숙소 유형'];
const groupsOf = (list: typeof PROFILE_PREFS) => [...new Set(list.map((x) => x.group))];

/** 내 정보: 우리 집, 같이 가는 인원, 반려견 크기, 늘 원하는 조건. 이 브라우저에만 저장돼요. */
export function ProfileModal({
  profile,
  home,
  onSave,
  onEditHome,
  onClearHome,
  onClose,
  initialCat = 'camp',
}: {
  initialCat?: 'camp' | 'pension';
  profile: Profile | null;
  home: Home | null;
  onSave: (p: Profile | null) => void;
  onEditHome: () => void;
  onClearHome: () => void;
  onClose: () => void;
}) {
  const [p, setP] = useState<Profile>(profile ?? {});
  // 늘 원하는 조건은 숙소 종류별로 따로 저장해요
  // 지금 보고 있는 카테고리(캠핑장·펜션) 탭으로 열어요
  const [cat, setCat] = useState<'camp' | 'pension'>(initialCat);
  const LIST = cat === 'camp' ? PROFILE_PREFS : PENSION_PREFS;
  const field = cat === 'camp' ? 'prefs' : 'pensionPrefs';
  const GROUPS = groupsOf(LIST);
  const [groupPick, setGroup] = useState(GROUPS[0]);
  const group = GROUPS.includes(groupPick) ? groupPick : GROUPS[0];
  const [tip, setTip] = useState<string | null>(null); // 휴대폰에서 막힌 조건을 눌렀을 때 이유를 보여 줘요
  const prefs = p[field] ?? [];
  const blocked = (key: string) =>
    key === 'nokids' && (p.kids ?? 0) > 0
      ? '아이 인원이 있어서 고를 수 없어요. 아이를 0명으로 바꾸면 고를 수 있어요.'
      : key === 'nopet' && p.petSize
        ? '반려견과 함께 가는 걸로 돼 있어서 고를 수 없어요. 반려견을 "없음"으로 바꾸면 고를 수 있어요.'
        : '';
  const toggle = (key: string) =>
    setP((v) => {
      const cur = v[field] ?? [];
      if (cur.includes(key)) return { ...v, [field]: cur.filter((k) => k !== key) };
      const g = LIST.find((x) => x.key === key)?.group;
      const keep = cur.filter((k) => !(g && SINGLE_GROUPS.includes(g) && LIST.find((x) => x.key === k)?.group === g));
      return { ...v, [field]: [...keep, key] };
    });
  const countIn = (g: string) => prefs.filter((k) => LIST.find((x) => x.key === k)?.group === g).length;

  const Stepper = ({ label, value, onChange }: { label: string; value?: number; onChange: (n: number) => void }) => (
    <div className="flex items-center justify-between">
      <span className="text-sm text-stone-700">{label}</span>
      <div className="flex items-center gap-1">
        <button type="button" aria-label={`${label} 줄이기`} onClick={() => onChange(Math.max(0, (value ?? 0) - 1))} className="h-8 w-8 rounded-full border border-stone-300 text-stone-600 hover:bg-stone-50 disabled:opacity-30" disabled={!value}>
          −
        </button>
        <span className="w-7 text-center text-sm font-medium tabular-nums">{value ?? 0}</span>
        <button type="button" aria-label={`${label} 늘리기`} onClick={() => onChange((value ?? 0) + 1)} className="h-8 w-8 rounded-full border border-stone-300 text-stone-600 hover:bg-stone-50">
          +
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-stone-900/30 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="rise flex h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:h-auto sm:max-h-[88vh] sm:max-w-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 머리 */}
        <div className="flex items-start justify-between gap-4 border-b border-stone-100 px-5 py-4 sm:px-6">
          <div>
            <p className="text-base font-semibold">내 정보</p>
            <p className="mt-0.5 text-sm text-stone-500">새 대화에 기본으로 반영돼요. 대화에서 다르게 말하면 그게 우선이에요.</p>
          </div>
          <button onClick={onClose} aria-label="닫기" className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800">
            <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* 몸통 (스크롤) */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
          {/* 기본 정보: 넓은 화면에서는 두 칸 */}
          <section>
            <p className="mb-2 text-sm font-semibold text-stone-800">기본 정보</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-stone-200 p-3.5 sm:col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-stone-500">우리 집 (동까지만)</p>
                    <p className="truncate text-sm text-stone-800">{home ? home.address || home.label : '아직 등록하지 않았어요'}</p>
                  </div>
                  <div className="flex shrink-0 gap-3">
                    {home && (
                      <button onClick={onClearHome} className="text-sm text-stone-500 hover:text-rose-600 hover:underline">
                        삭제
                      </button>
                    )}
                    <button onClick={onEditHome} className="text-sm font-medium text-brand-700 hover:underline">
                      {home ? '변경' : '등록'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="space-y-2 rounded-xl border border-stone-200 p-3.5">
                <p className="text-xs text-stone-500">주로 같이 가는 인원</p>
                <Stepper label="어른" value={p.adults} onChange={(n) => setP((v) => ({ ...v, adults: n }))} />
                <Stepper
                  label="아이"
                  value={p.kids}
                  onChange={(n) => setP((v) => ({ ...v, kids: n, prefs: n > 0 ? v.prefs?.filter((k) => k !== 'nokids') : v.prefs }))}
                />
              </div>
              <div className="rounded-xl border border-stone-200 p-3.5">
                <p className="text-xs text-stone-500">반려견</p>
                <p className="mb-2 text-[11px] text-stone-400">"강아지랑"이라고만 해도 크기를 다시 묻지 않아요</p>
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-stone-100 p-1 text-sm">
                  {[
                    { v: undefined, label: '없음' },
                    { v: 'small' as const, label: '소형견' },
                    { v: 'big' as const, label: '중·대형견' },
                  ].map((o) => (
                    <button
                      key={o.label}
                      onClick={() => setP((v) => ({ ...v, petSize: o.v, prefs: o.v ? v.prefs?.filter((k) => k !== 'nopet') : v.prefs }))}
                      className={`rounded-md py-1.5 ${p.petSize === o.v ? 'bg-white font-medium text-brand-700 shadow-sm' : 'text-stone-600 hover:text-stone-900'}`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-stone-400">소형견은 10kg 미만</p>
              </div>
            </div>
          </section>

          {/* 늘 원하는 조건: 묶음별 탭으로 나눠서 한 번에 보이는 선택지를 줄여요 */}
          <section>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-stone-800">늘 원하는 조건</p>
              <p className="text-xs text-stone-500">선호로 반영돼요 (안 맞아도 빠지지 않아요)</p>
            </div>
            <div className="mb-3 inline-flex rounded-lg bg-stone-100 p-1 text-xs">
              {(['camp', 'pension'] as const).map((k) => {
                const n = (k === 'camp' ? p.prefs : p.pensionPrefs)?.length ?? 0;
                return (
                  <button
                    key={k}
                    onClick={() => {
                      setCat(k);
                      setTip(null);
                    }}
                    className={`rounded-md px-3 py-1 ${cat === k ? 'bg-white font-medium text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}
                  >
                    {k === 'camp' ? '캠핑장' : '펜션·민박'}
                    {n > 0 && <span className="ml-1 text-brand-600">{n}</span>}
                  </button>
                );
              })}
            </div>
            {prefs.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {prefs.map((k) => {
                  const o = LIST.find((x) => x.key === k);
                  if (!o) return null;
                  return (
                    <button
                      key={k}
                      onClick={() => toggle(k)}
                      className="flex items-center gap-1 rounded-full bg-brand-600 py-1 pl-3 pr-2 text-xs font-medium text-white hover:bg-brand-700"
                      aria-label={`${o.label} 빼기`}
                    >
                      {o.label}
                      <span aria-hidden className="text-white/70">✕</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="rounded-xl border border-stone-200">
              <div className="flex gap-4 overflow-x-auto overflow-y-hidden border-b border-stone-200 px-3 [scrollbar-width:none]">
                {GROUPS.map((g) => (
                  <button
                    key={g}
                    onClick={() => {
                      setGroup(g);
                      setTip(null);
                    }}
                    className={`-mb-px shrink-0 border-b-2 py-2.5 text-sm transition ${
                      group === g ? 'border-brand-600 font-semibold text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-800'
                    }`}
                  >
                    {g}
                    {countIn(g) > 0 && <span className="ml-1 text-xs font-medium text-brand-700">{countIn(g)}</span>}
                  </button>
                ))}
              </div>
              <div className="p-3">
                {SINGLE_GROUPS.includes(group) && <p className="mb-2 text-xs text-stone-500">하나만 고를 수 있어요</p>}
                <div className="flex flex-wrap gap-1.5">
                  {LIST.filter((x) => x.group === group).map((o) => {
                    const on = prefs.includes(o.key);
                    const why = blocked(o.key);
                    return (
                      <span key={o.key} className="group/tip relative">
                        <button
                          onClick={() => (why ? setTip(tip === o.key ? null : o.key) : toggle(o.key))}
                          aria-disabled={!!why}
                          className={`rounded-full border px-3 py-1.5 text-sm ${
                            why
                              ? 'cursor-not-allowed border-stone-200 text-stone-300'
                              : on
                                ? 'border-brand-600 bg-brand-50 font-medium text-brand-700'
                                : 'border-stone-300 text-stone-600 hover:border-brand-500'
                          }`}
                        >
                          {on ? '✓ ' : ''}
                          {o.label}
                        </button>
                        {/* 고를 수 없는 이유: 마우스를 올리거나(데스크톱) 누르면(휴대폰) 보여요 */}
                        {why && (
                          <span
                            role="tooltip"
                            className={`pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-60 -translate-x-1/2 rounded-lg bg-stone-800 px-3 py-2 text-xs leading-relaxed text-white shadow-lg group-hover/tip:block ${tip === o.key ? 'block' : 'hidden'}`}
                          >
                            {why}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>

              </div>
            </div>
          </section>
        </div>

        {/* 발 (고정) */}
        <div className="flex items-center justify-between gap-3 border-t border-stone-100 px-5 py-3 sm:px-6">
          <button onClick={() => onSave(null)} className="text-xs text-stone-500 underline-offset-2 hover:text-rose-600 hover:underline">
            내 정보 지우기
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-9 rounded-lg px-3 text-sm text-stone-600 hover:bg-stone-100">
              취소
            </button>
            <button onClick={() => onSave(p)} className="h-9 rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700">
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 첫 화면·입력창 위에 보여 줄 한 줄 요약 */
/** 상단 요약용: 기본 정보와 카테고리별 늘 원하는 조건을 따로 */
export function profileRows(p: Profile | null) {
  if (!p) return { base: '', camp: '', pension: '' };
  const base: string[] = [];
  const n = (p.adults ?? 0) + (p.kids ?? 0);
  if (n) base.push(p.kids ? `어른 ${p.adults ?? 0} · 아이 ${p.kids}` : `어른 ${n}`);
  if (p.petSize) base.push(p.petSize === 'small' ? '소형견' : '중·대형견');
  const camp = (p.prefs ?? []).map((k) => PROFILE_PREFS.find((x) => x.key === k)?.label).filter(Boolean);
  const pen = (p.pensionPrefs ?? []).map((k) => PENSION_PREFS.find((x) => x.key === k)?.label).filter(Boolean);
  return { base: base.join(' · '), camp: camp.join(' · '), pension: pen.join(' · ') };
}

/** cat을 주면 그 카테고리의 늘 원하는 조건만, 없으면 둘 다 보여 줘요 */
export function profileSummary(p: Profile | null, cat?: 'camp' | 'pension') {
  if (!p) return '';
  const parts: string[] = [];
  const n = (p.adults ?? 0) + (p.kids ?? 0);
  if (n) parts.push(p.kids ? `어른 ${p.adults ?? 0} · 아이 ${p.kids}` : `어른 ${n}`);
  if (p.petSize) parts.push(p.petSize === 'small' ? '소형견' : '중·대형견');
  // 카테고리를 정하지 않으면(상단 요약) 어느 카테고리 조건인지 이름을 붙여요
  if (cat !== 'pension') {
    const camp = (p.prefs ?? []).map((k) => PROFILE_PREFS.find((x) => x.key === k)?.label).filter(Boolean);
    if (camp.length) parts.push(cat ? camp.join(' · ') : `캠핑: ${camp.join('·')}`);
  }
  if (cat !== 'camp') {
    const pen = (p.pensionPrefs ?? []).map((k) => PENSION_PREFS.find((x) => x.key === k)?.label).filter(Boolean);
    if (pen.length) parts.push(cat ? pen.join(' · ') : `펜션: ${pen.join('·')}`);
  }
  return parts.join(' · ');
}
