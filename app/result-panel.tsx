'use client';

import { useEffect, useRef, useState } from 'react';
import type { AgentReply } from '@/lib/types';
import { DetailView, ExtraView, ResultTable, type RankChanges } from './components';

/** 이전 결과와 비교한 순위 변화 (이전에 없던 곳은 NEW) */
export function rankChanges(cur?: AgentReply, prev?: AgentReply): RankChanges | undefined {
  if (!cur?.rows || !prev?.rows) return undefined;
  const before = new Map(prev.rows.map((r) => [r.id, r.rank]));
  return Object.fromEntries(cur.rows.map((r) => [r.id, before.has(r.id) ? before.get(r.id)! - r.rank : 'new']));
}

/** 이전 결과 이후 바뀐 조건 (추가된 것 / 빠진 것) */
export function condDiff(cur?: AgentReply, prev?: AgentReply) {
  if (!cur?.understood || !prev?.understood) return null;
  const a = new Set(prev.understood.map((u) => u.label));
  const b = new Set(cur.understood.map((u) => u.label));
  const added = [...b].filter((x) => !a.has(x));
  const removed = [...a].filter((x) => !b.has(x));
  return added.length || removed.length ? { added, removed } : null;
}

function DiffLine({ cur, prev }: { cur: AgentReply; prev?: AgentReply }) {
  const d = condDiff(cur, prev);
  const ch = rankChanges(cur, prev);
  if (!prev?.rows) return null;
  const fresh = ch ? Object.values(ch).filter((v) => v === 'new').length : 0;
  const moved = ch ? Object.values(ch).filter((v) => typeof v === 'number' && v !== 0).length : 0;
  return (
    <div className="rounded-lg bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-600">
      {d ? (
        <p>
          <span className="font-medium text-stone-800">이전 결과에서 바뀐 조건</span>{' '}
          {d.added.map((x) => (
            <span key={`+${x}`} className="mr-1 inline-block rounded bg-brand-50 px-1.5 text-brand-700">+ {x}</span>
          ))}
          {d.removed.map((x) => (
            <span key={`-${x}`} className="mr-1 inline-block rounded bg-stone-200 px-1.5 text-stone-600 line-through">{x}</span>
          ))}
        </p>
      ) : (
        <p className="font-medium text-stone-800">이전 결과와 같은 조건으로 다시 찾았어요</p>
      )}
      <p className="mt-0.5">
        후보 {(prev.total ?? 0).toLocaleString()}곳 → {(cur.total ?? 0).toLocaleString()}곳
        {fresh > 0 && ` · 새로 들어온 곳 ${fresh}`}
        {moved > 0 && ` · 순위가 바뀐 곳 ${moved}`}
        {cur.dropped?.length ? ` · 빠진 곳 ${cur.dropped.length}` : ''}
      </p>
    </div>
  );
}

export type PanelTab = 'results' | 'detail' | 'extras';

export function ResultPanel({
  result,
  prev,
  detail,
  detailTabs = [],
  onPickDetail,
  onCloseDetail,
  tab,
  setTab,
  onAsk,
  onClose,
  sheet = false,
}: {
  result?: AgentReply;
  prev?: AgentReply;
  detail?: AgentReply;
  detailTabs?: { id: number; name: string }[]; // 이 대화에서 상세 보기한 숙소들 (탭으로 오가기)
  onPickDetail?: (id: number) => void;
  onCloseDetail?: (id: number) => void;
  tab: PanelTab;
  setTab: (t: PanelTab) => void;
  onAsk: (t: string) => void;
  onClose: () => void;
  sheet?: boolean;
}) {
  const showDetail = tab === 'detail' && detail?.detail;
  const extras = result?.extras ?? [];
  const showExtras = tab === 'extras' && extras.length > 0;
  // 패널 폭에 맞춰 표/카드를 골라요: 충분히 넓으면 조건별 열이 있는 표, 좁으면 카드
  const box = useRef<HTMLDivElement>(null);
  const [roomy, setRoomy] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setRoomy(e.contentRect.width >= 700));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 추천 후보 위(바뀐 조건·빈자리 확인)와 아래(빠진 곳·따로 찾은 곳) 내용: 표 모드와 카드 모드가 같이 써요
  const resultTop = result?.rows ? (
    <>
      <DiffLine cur={result} prev={prev} />
      {result.rows.some((r) => r.liveCheck) && (
        <button
          onClick={() => onAsk('빈자리 확인 가능한 곳만 확인해 줘')}
          className="flex w-full items-center justify-between rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-left text-xs text-brand-800 hover:border-brand-500"
        >
          <span>
            빈자리 자동 확인이 되는 곳 <b>{result.rows.filter((r) => r.liveCheck).map((r) => `${r.rank}번`).join(', ')}</b>
            <span className="ml-1 text-brand-700/70">(캠핑톡 공공 캠핑장)</span>
          </span>
          <span className="shrink-0 font-semibold">빈자리 확인 →</span>
        </button>
      )}
    </>
  ) : null;
  const hasBottom = !!result?.dropped?.length;
  const resultBottom = hasBottom && result ? (
    <>
      {result.dropped && result.dropped.length > 0 && (
        <details className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm">
          <summary className="cursor-pointer text-stone-700">
            이번 조건으로 빠진 곳 <span className="font-semibold">{result.dropped.length}곳</span>
          </summary>
          <ul className="mt-2 space-y-1">
            {result.dropped.map((x) => (
              <li key={x.id} className="flex flex-wrap gap-x-2 text-xs">
                <span className="font-medium text-stone-800">{x.name}</span>
                <span className="text-stone-500">{x.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  ) : null;
  return (
    <div ref={box} className="flex h-full min-h-0 flex-col bg-stone-50">
      <div className={`relative flex items-center gap-1 border-b border-stone-200 bg-white px-3 ${sheet ? 'pb-2 pt-4' : 'py-2'}`}>
        {sheet && <span className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-stone-300" aria-hidden />}
{/* 이름으로 상세만 물어본 대화처럼 추천 후보가 없으면 탭을 숨겨요 */}
        {result?.rows?.length ? (
        <button
            onClick={() => setTab('results')}
            disabled={!result}
            className={`rounded-md px-2.5 py-1.5 text-sm ${!showDetail && !showExtras ? 'bg-stone-100 font-semibold text-stone-900' : 'text-stone-500 hover:text-stone-800'} disabled:opacity-40`}
          >
            추천 후보{result?.rows ? ` ${result.rows.length}` : ''}
          </button>
        ) : null}
        {extras.length > 0 && (
          <button
            onClick={() => setTab('extras')}
            title="카카오맵에서만 찾아서 조건을 확인하지 못한 곳"
            className={`shrink-0 rounded-md px-2.5 py-1.5 text-sm ${showExtras ? 'bg-stone-100 font-semibold text-stone-900' : 'text-stone-500 hover:text-stone-800'}`}
          >
            확인 못 한 곳 {extras.length}
          </button>
        )}
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
          {detailTabs.map((t) => {
            const on = showDetail && detail?.detail?.name === t.name;
            return (
              <span
                key={t.id}
                className={`group flex max-w-[180px] shrink-0 items-center rounded-md text-sm ${on ? 'bg-stone-100 font-semibold text-stone-900' : 'text-stone-500 hover:bg-stone-50 hover:text-stone-800'}`}
              >
                <button onClick={() => onPickDetail?.(t.id)} className="truncate py-1.5 pl-2.5 pr-1" title={t.name}>
                  {t.name}
                </button>
                <button
                  onClick={() => onCloseDetail?.(t.id)}
                  aria-label={`${t.name} 탭 닫기`}
                  className={`mr-1 rounded px-1 text-xs text-stone-400 hover:bg-stone-200 hover:text-stone-700 ${on ? '' : 'opacity-0 group-hover:opacity-100'}`}
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>
        <button onClick={onClose} aria-label="결과 패널 닫기" className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800">
          <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {result?.rows && result.columns && !showDetail && !showExtras ? (
        // 결과는 패널을 꽉 채우고 목록 하나만 스크롤해요 (넓으면 표, 좁으면 카드)
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 space-y-2 border-b border-stone-200 p-3 empty:hidden">{resultTop}</div>
          <ResultTable
            columns={result.columns}
            rows={result.rows}
            onAsk={onAsk}
            layout={roomy ? 'table' : 'cards'}
            fill
            changes={rankChanges(result, prev)}
            footer={resultBottom}
          />
        </div>
      ) : (
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {showDetail ? (
          <>
            {result?.rows?.length ? (
              <button onClick={() => setTab('results')} className="text-xs text-stone-500 hover:text-brand-700">
                ← 추천 후보로 돌아가기
              </button>
            ) : null}
            <DetailView d={detail!.detail!} onAsk={onAsk} />
            <div className="flex flex-wrap gap-2">
              {detail!.chips.slice(0, 3).map((c) => (
                <button key={c} onClick={() => onAsk(c)} className="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs text-stone-700 hover:border-brand-500 hover:text-brand-700">
                  {c}
                </button>
              ))}
            </div>
          </>
        ) : showExtras ? (
          <ExtraView items={extras} wide={roomy} />
        ) : result?.rows && result.columns ? (
          <>
            {resultTop}
            <ResultTable
              columns={result.columns}
              rows={result.rows}
              onAsk={onAsk}
              layout={roomy ? 'table' : 'cards'}
              changes={rankChanges(result, prev)}
            />
            {resultBottom}
          </>
        ) : (
          <p className="px-2 py-10 text-center text-sm text-stone-500">아직 추천 후보가 없어요. 조건을 말해 주시면 여기에 정리해 드릴게요.</p>
        )}
      </div>
      )}
    </div>
  );
}
