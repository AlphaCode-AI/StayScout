'use client';

import { Fragment, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AgentReply, Column, DetailCard as Detail, Relax, Row, Stage, Verdict } from '@/lib/types';

const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`);

/** 내 정보에서 들어온 조건 표시용 작은 집 아이콘 */
export function HomeMark({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={`inline-block shrink-0 ${className}`} aria-hidden>
      <path d="M3 9.5L10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

export function Understood({ items }: { items: NonNullable<AgentReply['understood']> }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-stone-500">이렇게 이해했어요</span>
      {items.map((u) => (
        <span
          key={u.label}
          className={
            u.tone === 'must'
              ? 'rounded-full bg-brand-600 px-2.5 py-1 text-xs font-medium text-white'
              : u.profile
                ? 'inline-flex items-center rounded-full border border-dashed border-brand-400 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700'
                : u.tone === 'pref'
                ? 'rounded-full border border-brand-500 px-2.5 py-1 text-xs font-medium text-brand-700'
                : 'rounded-full bg-stone-200 px-2.5 py-1 text-xs text-stone-700'
          }
        >
          {u.tone === 'must' && <span className="mr-1 opacity-75">필수</span>}
          {u.profile ? (
            <span className="mr-1 inline-flex items-center gap-0.5 opacity-75" title="내 정보에 저장한 늘 원하는 조건이에요">
              <HomeMark />
              내 정보
            </span>
          ) : (
            u.tone === 'pref' && <span className="mr-1 opacity-75">선호</span>
          )}
          {u.label}
        </span>
      ))}
    </div>
  );
}

export function Progress({ stages, animate, onDone }: { stages: Stage[]; animate: boolean; onDone: () => void }) {
  const [shown, setShown] = useState(animate ? 0 : stages.length);
  useEffect(() => {
    if (!animate) return;
    if (shown >= stages.length) {
      onDone();
      return;
    }
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 250 : 520);
    return () => clearTimeout(t);
  }, [shown, animate, stages.length, onDone]);

  const max = stages[0]?.count || 1;
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-stone-800">탐색 과정</p>
        <p className="text-xs text-stone-500">{shown < stages.length ? '찾는 중…' : '완료'}</p>
      </div>
      <ol className="space-y-2">
        {stages.map((s, i) => {
          const done = i < shown;
          const active = i === shown;
          return (
            <li key={s.label + i} className={`grid grid-cols-[20px_1fr_auto] items-center gap-3 ${done || active ? '' : 'opacity-35'}`}>
              <span className="flex h-5 w-5 items-center justify-center">
                {done ? (
                  <svg viewBox="0 0 20 20" className="h-5 w-5 text-brand-600" aria-hidden>
                    <circle cx="10" cy="10" r="9" fill="currentColor" opacity=".15" />
                    <path d="M6 10.5l2.5 2.5L14 7.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : active ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-stone-300" />
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm text-stone-800">{s.label}</p>
                <div className="mt-1 h-1.5 rounded-full bg-stone-100">
                  <div
                    className="h-1.5 rounded-full bg-brand-500 transition-all duration-500"
                    style={{ width: done ? `${Math.max(2, (s.count / max) * 100)}%` : '0%' }}
                  />
                </div>
                {s.note && done && <p className="mt-1 text-xs text-amber-700">{s.note}</p>}
              </div>
              <span className="w-16 text-right text-sm tabular-nums text-stone-700">{done ? `${s.count.toLocaleString()}곳` : ''}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const VERDICT_WORD: Record<Verdict, string> = { yes: '확인됨', likely: '근거로 추정', no: '맞지 않음', unknown: '확인 필요' };

function VerdictBadge({ v, text, full = false }: { v: Verdict; text: string; full?: boolean }) {
  const cls =
    v === 'yes'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
      : v === 'likely'
        ? 'bg-violet-50 text-violet-800 ring-violet-200'
        : v === 'no'
          ? 'bg-rose-50 text-rose-700 ring-rose-100'
          : 'bg-amber-50 text-amber-800 ring-amber-200';
  const mark = v === 'yes' ? '✓' : v === 'likely' ? '≈' : v === 'no' ? '✕' : '?';
  return (
    <span title={`${VERDICT_WORD[v]}: ${text}`} className={`group/b inline-flex items-start gap-1 rounded-md px-2 py-0.5 text-xs leading-snug ring-1 ${full ? '' : 'max-w-[180px]'} ${cls}`}>
      <span aria-hidden className="shrink-0">{mark}</span>
      <span className={full ? '' : 'line-clamp-2 group-hover/b:line-clamp-none'}>{text}</span>
    </span>
  );
}


/** 내 정보 조건 여러 개를 한 칸으로 묶어 보여 줘요 (표가 가로로 길어지지 않게).
 *  마우스를 올리면 조건마다 맞는지와 근거를 띄워요. 표가 overflow로 잘리지 않게 fixed로 띄워요. */
function ProfileSummary({ cols, cells }: { cols: Column[]; cells: Row['cells'] }) {
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const items = cols.map((c) => ({ key: c.key, label: c.label, ...cells[c.key] }));
  const n = (v: Verdict) => items.filter((i) => i.v === v).length;
  const good = items.filter((i) => i.v === 'yes' || i.v === 'likely');
  const order: Record<Verdict, number> = { yes: 0, likely: 1, unknown: 2, no: 3 };
  const sorted = [...items].sort((a, b) => order[a.v] - order[b.v]);
  const open = (e: React.MouseEvent | React.FocusEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const up = r.bottom + 260 > window.innerHeight;
    setPos({ x: Math.max(8, Math.min(r.left, window.innerWidth - 328)), y: up ? r.top - 6 : r.bottom + 6, up });
  };
  return (
    <span
      tabIndex={0}
      onMouseEnter={open}
      onMouseLeave={() => setPos(null)}
      onFocus={open}
      onBlur={() => setPos(null)}
      className="block cursor-help whitespace-nowrap text-xs leading-snug outline-none"
    >
      <span className="font-medium text-stone-800">
        {good.length}/{items.length} 맞음
      </span>
      <span className="ml-1.5 text-stone-500">
        {n('yes') > 0 && <span className="text-emerald-700">✓{n('yes')} </span>}
        {n('likely') > 0 && <span className="text-violet-700">≈{n('likely')} </span>}
        {n('no') > 0 && <span className="text-rose-700">✕{n('no')} </span>}
        {n('unknown') > 0 && <span className="text-amber-700">?{n('unknown')}</span>}
      </span>
      {pos &&
        createPortal(
        <span
          role="tooltip"
          style={{ left: pos.x, top: pos.y, transform: pos.up ? 'translateY(-100%)' : undefined }}
          className="pointer-events-none fixed z-50 block w-80 rounded-lg border border-stone-200 bg-white p-3 text-left shadow-xl"
        >
          <span className="mb-2 block text-xs font-semibold text-stone-800">내 정보 조건 {items.length}개 중 {good.length}개 맞음</span>
          <span className="block space-y-1.5">
            {sorted.map((i) => (
              <span key={i.key} className="flex items-start gap-2">
                <span className="w-20 shrink-0 pt-0.5 text-xs text-stone-500">{i.label}</span>
                <VerdictBadge v={i.v} text={i.text} full />
              </span>
            ))}
          </span>
        </span>,
          document.body,
        )}
    </span>
  );
}

/** 이전 결과 대비 순위 변화: 숫자(+는 올라감) 또는 'new' */
export type RankChanges = Record<string, number | 'new'>;

function RankDelta({ c }: { c?: number | 'new' }) {
  if (c === undefined || c === 0) return null;
  if (c === 'new') return <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">NEW</span>;
  return c > 0 ? (
    <span className="ml-1 text-[10px] font-semibold text-brand-700" title={`${c}계단 올라감`}>▲{c}</span>
  ) : (
    <span className="ml-1 text-[10px] font-semibold text-rose-600" title={`${-c}계단 내려감`}>▼{-c}</span>
  );
}

export function ResultTable({
  columns,
  rows,
  total,
  onAsk,
  layout = 'auto',
  changes,
  fill = false,
  footer,
}: {
  columns: Column[];
  rows: Row[];
  total: number;
  onAsk: (t: string) => void;
  layout?: 'auto' | 'cards' | 'table';
  changes?: RankChanges;
  /** 패널을 꽉 채우는 표: 테두리 없이 남은 높이를 다 쓰고, 표 하나만 스크롤해요 */
  fill?: boolean;
  /** fill일 때 표 아래(같은 스크롤 안)에 붙일 내용 */
  footer?: React.ReactNode;
}) {
  if (!rows.length) return null;
  // 필수 조건을 앞에, 선호 조건을 뒤에 (같은 종류끼리는 말한 순서대로). 내 정보 조건은 맨 뒤 한 칸
  const mainCols = [...columns.filter((c) => !c.fromProfile && c.must), ...columns.filter((c) => !c.fromProfile && !c.must)];
  const profCols = columns.filter((c) => c.fromProfile);
  const hasMinutes = rows.some((r) => r.minutes !== undefined);
  const cardsCls = layout === 'cards' ? '' : layout === 'table' ? 'hidden' : 'sm:hidden';
  const tableCls = layout === 'cards' ? 'hidden' : layout === 'table' ? 'block' : 'hidden sm:block';
  const filled = fill && layout !== 'auto';
  return (
    <div className={filled ? 'flex min-h-0 flex-1 flex-col bg-white' : 'rise overflow-hidden rounded-xl border border-stone-200 bg-white'}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-stone-100 px-4 py-3">
        <p className="whitespace-nowrap text-sm font-semibold text-stone-800">
          추천 {rows.length}곳
        </p>
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-stone-500 [&>span]:whitespace-nowrap">
          <span>✓ 확인됨</span>
          <span>≈ 근거로 추정</span>
          <span>✕ 맞지 않음</span>
          <span>? 확인 필요</span>
          {layout !== 'cards' && columns.some((c) => c.fromProfile) && <span className="text-brand-700">내 정보 조건은 한 칸에 모아 보여요</span>}
        </p>
      </div>
      {/* 휴대폰·좁은 패널: 카드 목록 */}
      <div className={`${filled ? 'min-h-0 flex-1 overflow-y-auto' : ''} ${cardsCls}`}>
      <ul className="divide-y divide-stone-100">
        {rows.map((r) => (
          <li
            key={r.id}
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest('a,button')) onAsk(`${r.rank}번 자세히 보기`);
            }}
            className="cursor-pointer px-4 py-3 hover:bg-stone-50/70"
          >
            <div className="flex items-start justify-between gap-2">
              <button onClick={() => onAsk(`${r.rank}번 자세히 보기`)} className="shrink-0" aria-label={`${r.name} 자세히 보기`}>
                <Thumb src={r.image} className="h-16 w-20" />
              </button>
              <button onClick={() => onAsk(`${r.rank}번 자세히 보기`)} className="min-w-0 flex-1 text-left">
                <span className="mr-1.5 text-stone-400">{r.rank}</span>
                <span className="font-medium text-stone-900">{r.name}</span>
                <RankDelta c={changes?.[r.id]} />
                <span className="mt-0.5 block text-xs text-stone-500">
                  {r.area} · {r.type}
                  {r.minutes !== undefined && ` · 약 ${fmtMin(r.minutes)}`}
                </span>
                {r.place?.renamed && <span className="mt-0.5 block text-xs text-amber-700">카카오맵 이름: {r.place.name}</span>}
                <ReserveNote r={r} />
              </button>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                {r.reserve.url && (
                  <a href={r.reserve.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-700">
                    {['홈페이지', '블로그', '인스타그램'].includes(r.reserve.mode) ? r.reserve.mode : '예약'} ↗
                  </a>
                )}
                {r.google?.rating ? <span className="text-[11px] text-stone-500">구글 ★ {r.google.rating} ({r.google.reviews ?? 0})</span> : null}
                {r.pending && <span className="animate-pulse text-[11px] text-stone-400">링크 찾는 중…</span>}
              </span>
            </div>
            <dl className="mt-2 space-y-1.5">
              {mainCols.map((c) => (
                <div key={c.key} className="flex items-start gap-2">
                  <dt className="w-24 shrink-0 pt-0.5 text-xs text-stone-500">
                    {c.label}
                    {c.must && <span className="text-brand-700">*</span>}

                  </dt>
                  <dd>
                    <VerdictBadge {...r.cells[c.key]} full />
                  </dd>
                </div>
              ))}
              {profCols.length > 0 && (
                <div className="flex items-start gap-2">
                  <dt className="w-24 shrink-0 pt-0.5 text-xs text-brand-700">내 정보</dt>
                  <dd>
                    <ProfileSummary cols={profCols} cells={r.cells} />
                  </dd>
                </div>
              )}
            </dl>
            {r.liveCheck && (
              <button onClick={() => onAsk(`${r.rank}번 빈자리 확인해 줘`)} className="mt-2 rounded bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-100">
                빈자리 확인하기
              </button>
            )}
          </li>
        ))}
        <li className="px-4 py-2 text-[11px] text-stone-500">* 표시는 필수 조건이에요</li>
      </ul>
      {filled && footer && layout === 'cards' && <div className="space-y-3 border-t border-stone-200 bg-stone-50 p-3">{footer}</div>}
      </div>
      {/* 데스크톱: 표. 가로·세로 스크롤을 표 안에서 같이 하고, 머리줄과 숙소 열은 고정해요
          (가로 스크롤바가 10번째 줄 아래에 숨어 있지 않게 화면 높이에 맞춰요) */}
      <div className={`${filled ? 'min-h-0 flex-1' : 'max-h-[calc(100dvh-190px)] overscroll-contain'} overflow-auto ${tableCls}`}>
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="sticky top-0 z-20 bg-stone-50 text-xs text-stone-500 shadow-[0_1px_0_#e7e5e4]">
            <tr>
              <th className="sticky left-0 z-10 w-14 min-w-14 bg-stone-50 px-4 py-2 font-medium">#</th>
              <th className="sticky left-14 z-10 min-w-[190px] bg-stone-50 px-2 py-2 font-medium shadow-[1px_0_0_#e7e5e4]">숙소</th>
              {hasMinutes && <th className="px-2 py-2 font-medium">이동(추정)</th>}
              {mainCols.map((c) => (
                <th key={c.key} className="min-w-[130px] px-2 py-2 font-medium">
                  {c.label}
                  <span className={`ml-1 rounded px-1 text-[10px] ${c.must ? 'bg-brand-600 text-white' : 'border border-brand-500 text-brand-700'}`}>
                    {c.must ? '필수' : '선호'}
                  </span>
                </th>
              ))}
              {profCols.length > 0 && (
                <th className="whitespace-nowrap px-2 py-2 font-medium" title={`내 정보에 저장한 늘 원하는 조건: ${profCols.map((c) => c.label).join(', ')}`}>
                  <span className="text-brand-700">내 정보 조건</span>
                  <span className="ml-1 text-[10px] text-stone-400">{profCols.length}개</span>
                </th>
              )}
              <th className="px-2 py-2 font-medium">예약</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
              <tr
                onClick={(e) => {
                  // 링크·버튼이 아닌 곳을 누르면 상세 보기 (근거 문장 전부와 사진이 있어요)
                  if (!(e.target as HTMLElement).closest('a,button')) onAsk(`${r.rank}번 자세히 보기`);
                }}
                className="group cursor-pointer border-t border-stone-100 align-middle hover:bg-stone-50"
                title="눌러서 상세 보기"
              >
                <td className="sticky left-0 z-[1] w-14 min-w-14 whitespace-nowrap bg-white px-4 py-2.5 text-stone-500 tabular-nums group-hover:bg-stone-50">
                  {r.rank}
                  <RankDelta c={changes?.[r.id]} />
                </td>
                <td className="sticky left-14 z-[1] min-w-[190px] bg-white px-2 py-2.5 shadow-[1px_0_0_#e7e5e4] group-hover:bg-stone-50">
                  <div className="flex items-start gap-2.5">
                  <button onClick={() => onAsk(`${r.rank}번 자세히 보기`)} className="shrink-0" aria-label={`${r.name} 자세히 보기`}>
                    <Thumb src={r.image} className="h-11 w-14" />
                  </button>
                  <div className="min-w-0">
                  <button onClick={() => onAsk(`${r.rank}번 자세히 보기`)} className="text-left font-medium text-stone-900 hover:text-brand-700 hover:underline">
                    {r.name}
                  </button>
                  <p className="text-xs text-stone-500">
                    {r.area} · {r.type}
                    {r.inRegion && <span className="ml-1 text-brand-700">· 희망 지역</span>}
                    {r.extraSource && <span className="ml-1 text-stone-400" title={`출처: ${r.extraSource}`}>· 기본 정보만 있음</span>}
                    {r.place?.renamed && (
                      <a href={r.place.url} target="_blank" rel="noreferrer" className="ml-1 text-amber-700 hover:underline" title="같은 위치의 카카오맵 장소 이름이 달라요">
                        · 카카오맵 이름: {r.place.name}
                      </a>
                    )}
                    {r.liveCheck && (
                      <button onClick={() => onAsk(`${r.rank}번 빈자리 확인해 줘`)} className="ml-1.5 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 ring-1 ring-brand-100 hover:bg-brand-100">
                        빈자리 확인 가능
                      </button>
                    )}
                  </p>
                  </div>
                  </div>
                </td>
                {hasMinutes && <td className="whitespace-nowrap px-2 py-2.5 tabular-nums text-stone-700">{r.minutes !== undefined ? fmtMin(r.minutes) : '-'}</td>}
                {mainCols.map((c) => (
                  <td key={c.key} className="px-2 py-2.5">
                    <VerdictBadge {...r.cells[c.key]} />
                  </td>
                ))}
                {profCols.length > 0 && (
                  <td className="px-2 py-2.5">
                    <ProfileSummary cols={profCols} cells={r.cells} />
                  </td>
                )}
                <td className="whitespace-nowrap px-2 py-2.5 text-xs">
                  {r.reserve.url ? (
                    <a href={r.reserve.url} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">
                      {r.reserve.mode} ↗
                    </a>
                  ) : (
                    <span className="text-stone-500">{r.reserve.mode}</span>
                  )}
                  {r.google?.rating ? (
                    <a href={r.google.mapsUrl} target="_blank" rel="noreferrer" className="mt-0.5 block text-[11px] text-stone-500 hover:text-brand-700" title="구글에 등록된 평점">
                      구글 ★ {r.google.rating} ({r.google.reviews ?? 0})
                    </a>
                  ) : null}
                  {r.pending && <span className="mt-0.5 block animate-pulse text-[11px] text-stone-400">링크·평점 찾는 중…</span>}
                  <ReserveNote r={r} />
                </td>
              </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
        {/* 표 아래 내용은 가로로 밀려도 제자리에 있게 왼쪽에 고정 */}
        {filled && footer && layout === 'table' && <div className="sticky left-0 space-y-3 border-t border-stone-200 bg-stone-50 p-3">{footer}</div>}
      </div>
    </div>
  );
}

export function RelaxCard({ relax, onAsk }: { relax: Relax[]; onAsk: (t: string) => void }) {
  if (!relax.length) return null;
  return (
    <div className="rise rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <p className="text-sm font-semibold text-stone-800">이렇게 풀면 선택지가 늘어나요</p>
      <ul className="mt-2 space-y-1.5">
        {relax.map((r) => (
          <li key={r.label}>
            <button
              onClick={() => onAsk(r.label)}
              className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-sm ring-1 ring-amber-200 hover:ring-amber-400"
            >
              <span>{r.label.replace(/ 찾아 줘| 넓혀 줘/, '')}</span>
              {r.gain > 0 && <span className="text-xs font-semibold text-brand-700">+{r.gain.toLocaleString()}곳</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DraftCard({ draft }: { draft: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rise rounded-xl border border-stone-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-stone-800">문의 메시지 초안</p>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(draft);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50"
        >
          {copied ? '복사됨' : '복사'}
        </button>
      </div>
      <pre className="whitespace-pre-wrap rounded-lg bg-stone-50 p-3 font-sans text-sm leading-relaxed text-stone-800">{draft}</pre>
      <p className="mt-2 text-xs text-stone-500">전송은 사용자 승인 후에만 해요.</p>
    </div>
  );
}

/** 숙소 사진 썸네일. 사진이 없는 곳(공공데이터에 사진이 없거나 다른 출처로 추가된 곳)은 집 그림으로 채워요. */
export function Thumb({ src, className = '' }: { src?: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <span className={`flex items-center justify-center rounded-md bg-brand-50 text-brand-300 ${className}`} aria-hidden>
        <svg viewBox="0 0 24 24" className="h-1/2 w-1/2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 11l8-6.5 8 6.5" />
          <path d="M6.5 9.5V19h11V9.5" />
          <path d="M10.5 19v-4.5h3V19" />
        </svg>
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={`rounded-md object-cover ${className}`} />
  );
}

/** 상세 보기 사진: 옆으로 넘겨 보는 갤러리 */
function Gallery({ images, name }: { images: string[]; name: string }) {
  const [i, setI] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(false);
  const list = images.filter((x) => !failed.has(x));
  const n = list.length;
  const cur = Math.min(i, Math.max(0, n - 1));
  // 크게 보기: Esc로 닫고 ← →로 넘겨요
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoom(false);
      else if (e.key === 'ArrowLeft') setI((v) => (Math.min(v, n - 1) - 1 + n) % n);
      else if (e.key === 'ArrowRight') setI((v) => (Math.min(v, n - 1) + 1) % n);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [zoom, n]);
  if (!n) return null;
  return (
    <div className="bg-stone-100">
      <div className="relative">
        <button onClick={() => setZoom(true)} className="block w-full cursor-zoom-in" aria-label="사진 크게 보기" title="눌러서 크게 보기">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={list[cur]}
            src={list[cur]}
            alt={`${name} 사진 ${cur + 1}`}
            referrerPolicy="no-referrer"
            onError={() => setFailed((f) => new Set(f).add(list[cur]))}
            className="h-56 w-full object-cover"
          />
        </button>
        {list.length > 1 && (
          <>
            <button
              onClick={() => setI((cur - 1 + list.length) % list.length)}
              aria-label="이전 사진"
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/85 px-2.5 py-1 text-sm shadow hover:bg-white"
            >
              ‹
            </button>
            <button
              onClick={() => setI((cur + 1) % list.length)}
              aria-label="다음 사진"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/85 px-2.5 py-1 text-sm shadow hover:bg-white"
            >
              ›
            </button>
            <span className="absolute bottom-2 right-2 rounded-full bg-stone-900/60 px-2 py-0.5 text-[11px] text-white">
              {cur + 1} / {list.length}
            </span>
          </>
        )}
      </div>
      {list.length > 1 && (
        <div className="flex gap-1 overflow-x-auto bg-white p-1.5">
          {list.map((src, k) => (
            <button key={src} onClick={() => setI(k)} className={`shrink-0 rounded ${k === cur ? 'ring-2 ring-brand-500' : 'opacity-70 hover:opacity-100'}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setFailed((f) => new Set(f).add(src))}
                className="h-10 w-14 rounded object-cover"
              />
            </button>
          ))}
        </div>
      )}
      {zoom &&
        createPortal(
          <div className="fixed inset-0 z-50 flex flex-col bg-stone-950/90" onClick={() => setZoom(false)} role="dialog" aria-modal="true" aria-label={`${name} 사진 크게 보기`}>
            <div className="flex shrink-0 items-center justify-between px-4 py-3 text-sm text-white/90">
              <span className="truncate font-medium">
                {name} <span className="ml-1 text-white/60">{cur + 1} / {n}</span>
              </span>
              <button onClick={() => setZoom(false)} aria-label="닫기" className="rounded-full px-3 py-1 text-lg leading-none text-white/80 hover:bg-white/10 hover:text-white">
                ✕
              </button>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center px-14">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={list[cur]}
                src={list[cur]}
                alt={`${name} 사진 ${cur + 1}`}
                referrerPolicy="no-referrer"
                onClick={(e) => e.stopPropagation()}
                className="max-h-full max-w-full rounded object-contain shadow-2xl"
              />
              {n > 1 && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setI((cur - 1 + n) % n);
                    }}
                    aria-label="이전 사진"
                    className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/15 px-3.5 py-2 text-2xl leading-none text-white hover:bg-white/30"
                  >
                    ‹
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setI((cur + 1) % n);
                    }}
                    aria-label="다음 사진"
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/15 px-3.5 py-2 text-2xl leading-none text-white hover:bg-white/30"
                  >
                    ›
                  </button>
                </>
              )}
            </div>
            {n > 1 && (
              <div className="flex shrink-0 justify-center gap-1.5 overflow-x-auto px-4 py-3 [scrollbar-width:none]" onClick={(e) => e.stopPropagation()}>
                {list.map((src, k2) => (
                  <button key={src} onClick={() => setI(k2)} className={`shrink-0 rounded ${k2 === cur ? 'ring-2 ring-white' : 'opacity-50 hover:opacity-100'}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" referrerPolicy="no-referrer" className="h-12 w-16 rounded object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function DetailView({ d, onAsk }: { d: Detail; onAsk?: (t: string) => void }) {
  // 비슷한 곳 찾기: 같은 이름이 여러 지역에 있을 수 있어서 시·군을 같이 보내요 (주소 두 번째 낱말)
  const area = d.address.split(/\s+/)[1];
  const last = d.name.charCodeAt(d.name.length - 1);
  const wa = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 ? '과' : '와';
  const similarAsk = `${d.name}${area ? ` (${area})` : ''}${wa} 비슷한 곳 찾아줘`;
  const images = d.images?.length ? d.images : d.image ? [d.image] : [];
  return (
    <div className="rise overflow-hidden rounded-xl border border-stone-200 bg-white">
      {images.length > 0 ? <Gallery images={images} name={d.name} /> : <Thumb className="h-32 w-full rounded-none" />}
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-base font-semibold">{d.name}</p>
          {onAsk && (
            <button
              onClick={() => onAsk(similarAsk)}
              title="유형·시설·입지·규모가 비슷한 곳을 1시간 거리 안에서 찾아요"
              className="rounded-full border border-brand-500 px-2.5 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
            >
              비슷한 곳 찾기
            </button>
          )}
        </div>
        {d.intro && <p className="mt-0.5 text-sm text-stone-600">{d.intro}</p>}
        <p className="mt-1 text-xs text-stone-500">{d.address}</p>
        <dl className="mt-3 grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-sm">
          {d.facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-stone-500">{f.label}</dt>
              <dd className="text-stone-800">{f.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {d.links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
              {l.label} ↗
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Chips({ chips, onAsk, disabled }: { chips: string[]; onAsk: (t: string) => void; disabled?: boolean }) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <button
          key={c}
          disabled={disabled}
          onClick={() => onAsk(c)}
          className="max-w-full truncate rounded-full border border-stone-300 bg-white px-3.5 py-1.5 text-sm text-stone-700 shadow-sm transition hover:border-brand-500 hover:text-brand-700 disabled:opacity-50"
        >
          {c}
        </button>
      ))}
    </div>
  );
}

export function Trace({ steps }: { steps: import('@/lib/types').TraceStep[] }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  return (
    <div className="rounded-lg border border-dashed border-brand-500/40 bg-brand-50/50 px-3 py-2">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center gap-1.5 text-left text-xs text-stone-600">
        <span className="mr-1 font-semibold text-brand-700">에이전트가 고른 순서</span>
        {steps.map((s, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-stone-400">→</span>}
            <span className="rounded bg-white px-1.5 py-0.5 ring-1 ring-brand-100">
              {s.label}
              {s.result && <span className="ml-1 text-stone-500">{s.result}</span>}
            </span>
          </span>
        ))}
        <span className="ml-auto text-stone-400">{open ? '접기' : '이유 보기'}</span>
      </button>
      {open && (
        <ol className="mt-2 space-y-1 border-t border-brand-100 pt-2 text-xs text-stone-600">
          {steps.map((s, i) => (
            <li key={i}>
              <span className="font-medium text-stone-800">
                {i + 1}. {s.label}
              </span>
              {s.reason ? ` — ${s.reason}` : ''}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function AvailabilityCard({ a }: { a: import('@/lib/availability').Availability }) {
  if (a.status !== 'ok') {
    return (
      <div className="rise rounded-xl border border-stone-200 bg-white p-4">
        <p className="text-sm font-semibold text-stone-800">{a.camp} · 빈자리</p>
        <p className="mt-1 text-sm text-stone-600">{a.reason}</p>
        <p className="mt-1 text-xs text-stone-500">예약처: {a.platform}</p>
        {a.url && (
          <a href={a.url} target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-md border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:border-brand-500 hover:text-brand-700">
            예약 페이지에서 직접 확인 ↗
          </a>
        )}
      </div>
    );
  }
  return (
    <div className="rise overflow-hidden rounded-xl border border-brand-100 bg-white">
      <div className="flex items-center justify-between border-b border-brand-100 bg-brand-50 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-stone-900">
            {a.camp} · {a.dateLabel} 빈자리
          </p>
          <p className="text-xs text-stone-600">
            {a.platform} 실시간 조회 · {a.checkedAt} 확인 · 예약 전에 다시 확인해 주세요
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${a.totalLeft ? 'bg-brand-600 text-white' : 'bg-rose-100 text-rose-700'}`}>
          {a.totalLeft ? `${a.totalLeft}자리 남음` : '마감'}
        </span>
      </div>
      <ul className="divide-y divide-stone-100">
        {a.zones.map((z) => (
          <li key={z.name} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span className={z.left ? 'text-stone-800' : 'text-stone-400'}>{z.name}</span>
            <span className="flex items-center gap-3">
              {z.left > 0 && z.minPrice !== undefined && <span className="text-xs text-stone-500">1박 {z.minPrice.toLocaleString()}원~</span>}
              {z.left > 0 && !z.fits && <span className="text-xs text-amber-700">인원 초과</span>}
              <span className={`w-14 text-right text-xs font-semibold tabular-nums ${z.left ? 'text-brand-700' : 'text-rose-600'}`}>
                {z.left ? `${z.left}/${z.total}` : '마감'}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className="px-4 py-3">
        <a href={a.url} target="_blank" rel="noreferrer" className="inline-block rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700">
          캠핑톡에서 예약하기 ↗
        </a>
      </div>
    </div>
  );
}

/** 조건을 확인하지 못한 캠핑장 (카카오맵에서만 찾은 곳). 결과 패널의 별도 탭에서 크게 보여 줘요 */
export function ExtraView({ items, wide = false }: { items: import('@/lib/types').ExtraPlace[]; wide?: boolean }) {
  if (!items.length) return null;
  const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`);
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-semibold">조건을 확인하지 못한 캠핑장 {items.length}곳</p>
        <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
          카카오맵에서만 찾은 곳이라 시설·반려견·운영 기간 정보가 없어요. 그래서 순위에는 넣지 않았어요. 전화나 지도에서 직접 확인해 주세요.
        </p>
      </div>
      <ul className={`grid gap-3 ${wide ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {items.map((p) => (
          <li key={p.id} className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4">
            <div>
              <p className="text-base font-semibold text-stone-900">{p.name}</p>
              <p className="mt-1 text-sm text-stone-600">{p.address}</p>
              <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
                {p.category && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">{p.category}</span>}
                {p.minutes !== undefined && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">이동 약 {fmt(p.minutes)} (추정)</span>}
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800 ring-1 ring-amber-200">? 조건 확인 필요</span>
              </p>
            </div>
            <div className="mt-auto flex flex-wrap gap-2 text-sm">
              {p.phone ? (
                <a href={`tel:${p.phone}`} className="rounded-lg border border-stone-200 px-3 py-1.5 text-stone-700 hover:border-brand-500 hover:text-brand-700">
                  ☎ {p.phone}
                </a>
              ) : (
                <span className="rounded-lg border border-dashed border-stone-200 px-3 py-1.5 text-stone-400">전화번호 없음</span>
              )}
              <a href={p.url} target="_blank" rel="noreferrer" className="rounded-lg border border-stone-200 px-3 py-1.5 font-medium text-brand-700 hover:border-brand-500">
                카카오맵 ↗
              </a>
              <a
                href={`https://search.naver.com/search.naver?query=${encodeURIComponent(p.name)}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-stone-200 px-3 py-1.5 text-stone-700 hover:border-brand-500 hover:text-brand-700"
              >
                네이버 검색 ↗
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 예약 링크가 옛 정보일 수 있을 때 붙는 안내 (고캠핑 갱신 1년 초과, 또는 카카오맵 이름이 다름) */
function ReserveNote({ r }: { r: Row }) {
  if (!r.stale && !r.place?.renamed && !r.reserve.dead) return null;
  const why = r.reserve.dead ? '링크가 열리지 않아요' : r.place?.renamed ? '이름이 바뀐 것 같아요' : `${r.asOf} 정보`;
  return (
    <span className="mt-0.5 block text-[11px] font-normal text-amber-700" title="예약 링크가 옮겨졌거나 닫혔을 수 있어요. 예약 전에 전화로 확인해 주세요.">
      {why}
      {r.place?.phone ? ` · ☎ ${r.place.phone}` : ' · 예약 전 확인'}
    </span>
  );
}
