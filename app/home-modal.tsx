'use client';

import { useState } from 'react';
import type { Home } from './history';

export function HomeModal({ home, onSave, onClose }: { home: Home | null; onSave: (h: Home | null) => void; onClose: () => void }) {
  const [q, setQ] = useState(home?.address ?? '');
  const [found, setFound] = useState<Home | null>(null);
  const [results, setResults] = useState<Home[]>([]); // 같은 이름의 동이 여러 곳이면 목록에서 골라요
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const search = async () => {
    if (!q.trim()) return;
    setLoading(true);
    setError('');
    setFound(null);
    setResults([]);
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(q.trim())}`);
      const d = await r.json();
      if (!r.ok) setError(d.error || '주소를 찾지 못했어요.');
      else {
        const list: Home[] = d.results ?? [{ lat: d.lat, lng: d.lng, label: d.label, address: d.address }];
        setResults(list);
        if (list.length === 1) setFound(list[0]);
      }
    } catch {
      setError('주소 검색에 실패했어요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-stone-900/30 p-4" onClick={onClose}>
      <div className="rise w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-base font-semibold">우리 집 설정</p>
        <p className="mt-1 text-sm text-stone-600">한 번 등록하면 "우리 집에서 2시간 이내"처럼 말할 수 있어요. 이동 시간 계산에는 동네만 있으면 돼서 번지는 저장하지 않아요. 이 브라우저에만 저장돼요.</p>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="동 이름이면 충분해요 (예: 성남시 수정구 신흥동)"
            className="h-10 flex-1 rounded-lg border border-stone-300 px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <button disabled={loading || !q.trim()} className="h-10 rounded-lg bg-stone-800 px-4 text-sm font-medium text-white disabled:opacity-40">
            {loading ? '찾는 중' : '검색'}
          </button>
        </form>
        {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        {results.length > 1 && (
          <div className="mt-3">
            <p className="mb-1.5 text-xs text-stone-500">{results.length}곳이 나왔어요. 우리 집을 골라 주세요.</p>
            <ul className="max-h-60 divide-y divide-stone-100 overflow-y-auto rounded-lg border border-stone-200">
              {results.map((r) => {
                const on = found?.address === r.address;
                return (
                  <li key={r.address}>
                    <button
                      onClick={() => setFound(r)}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${on ? 'bg-brand-50 font-medium text-brand-700' : 'text-stone-700 hover:bg-stone-50'}`}
                    >
                      <span>{r.address || r.label}</span>
                      {on && <span aria-hidden>✓</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {found && results.length <= 1 && (
          <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50 p-3">
            <p className="text-sm font-medium text-brand-700">{found.address || found.label}</p>
          </div>
        )}
        {home && !found && (
          <p className="mt-3 text-xs text-stone-500">
            지금 등록된 곳: <span className="font-medium text-stone-700">{home.address || home.label}</span>
          </p>
        )}
        <div className="mt-5 flex items-center justify-between">
          {home ? (
            <button onClick={() => onSave(null)} className="text-xs text-stone-500 underline-offset-2 hover:underline">
              등록 해제
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="h-9 rounded-lg px-3 text-sm text-stone-600 hover:bg-stone-100">
              취소
            </button>
            <button
              disabled={!found}
              onClick={() => found && onSave(found)}
              className="h-9 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
            >
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
