'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EXAMPLE_GROUPS, PENSION_EXAMPLE_GROUPS } from '@/lib/examples';
import type { AgentReply, AgentState, Places, Row } from '@/lib/types';
import { AvailabilityCard, Chips, DraftCard, Progress, RelaxCard, Trace, Understood } from './components';
import { ResultPanel, type PanelTab } from './result-panel';
import { loadConversations, loadHome, loadProfile, saveProfile, relativeTime, saveConversations, saveHome, summarize, type Conversation, type Home as HomeT, type Msg } from './history';
import { HomeModal } from './home-modal';
import { ProfileModal, profileRows, profileSummary } from './profile-modal';
import type { Profile } from '@/lib/profile';

const CATEGORIES: { name: string; key?: 'camp' | 'pension' }[] = [
  { name: '캠핑장', key: 'camp' },
  { name: '펜션·민박', key: 'pension' },
  { name: '호텔·모텔' },
];

const EMPTY: AgentState = { regions: [], conds: [] };
const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type AgentMsg = Extract<Msg, { role: 'agent' }>;

function AgentMessage({
  reply,
  latest,
  onAsk,
  resultActive,
  detailActive,
  onOpenResult,
  onOpenDetail,
}: {
  reply: AgentReply;
  latest: boolean;
  onAsk: (t: string) => void;
  resultActive: boolean;
  detailActive: boolean;
  onOpenResult: () => void;
  onOpenDetail: () => void;
}) {
  // 채팅은 텍스트 위주: 답변 글 + 결과로 가는 링크 한 줄. 조건·탐색 과정은 "과정 보기"로 접어 둬요.
  const stages = reply.stages ?? [];
  const hasProcess = !!(reply.understood?.length || reply.trace?.length || stages.length);
  const top = reply.rows?.[0];
  return (
    <div className="rise flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">S</div>
      <div className="min-w-0 flex-1 space-y-2.5">
        <p className="whitespace-pre-line text-[15px] leading-relaxed text-stone-800">{reply.text}</p>

        {reply.rows && reply.rows.length > 0 && reply.columns && (
          <button onClick={onOpenResult} className={`group flex max-w-full flex-wrap items-center gap-x-1.5 text-left text-sm ${resultActive ? 'text-brand-800' : 'text-brand-700'} hover:underline`}>
            <span className="whitespace-nowrap font-semibold">추천 후보 {reply.rows.length}곳</span>
            {top && <span className="min-w-0 truncate text-stone-500">· 1위 {top.name}</span>}
            <span className="whitespace-nowrap">{resultActive ? '(오른쪽에 보는 중)' : '보기 →'}</span>
          </button>
        )}
        {reply.detail && (
          <button onClick={onOpenDetail} className={`text-sm ${detailActive ? 'text-brand-800' : 'text-brand-700'} hover:underline`}>
            <span className="font-semibold">{reply.detail.name}</span> 상세 정보 {detailActive ? '(오른쪽에 보는 중)' : '보기 →'}
          </button>
        )}
        {reply.availability && <AvailabilityCard a={reply.availability} />}
        {reply.availabilities?.map((a, i) => <AvailabilityCard key={i} a={a} />)}
        {reply.draft && <DraftCard draft={reply.draft} />}
        {reply.relax && reply.relax.length > 0 && !reply.rows?.length && <RelaxCard relax={reply.relax} onAsk={onAsk} />}

        {hasProcess && (
          <details className="group text-xs text-stone-500">
            <summary className="cursor-pointer list-none select-none hover:text-stone-700">
              {stages.length > 1 ? `${stages[0].count.toLocaleString()}곳 → ${stages[stages.length - 1].count.toLocaleString()}곳 · ` : ''}
              <span className="underline-offset-2 group-open:underline">과정 보기</span>
              <span className="ml-0.5 inline-block transition group-open:rotate-180">▾</span>
            </summary>
            <div className="mt-2 space-y-3">
              {reply.understood && <Understood items={reply.understood} />}
              {reply.trace && <Trace steps={reply.trace} />}
              {reply.engine && reply.engine !== 'agent' && (
                <p className="text-[11px] text-stone-400">
                  {reply.engine === 'gemini' ? 'Gemini가 조건을 해석하고, 정해진 순서로 처리했어요' : '규칙 기반으로 처리했어요 (Gemini 연결 안 됨)'}
                </p>
              )}
              {stages.length > 0 && <Progress stages={stages} animate={false} onDone={noop} />}
            </div>
          </details>
        )}
        {latest && <Chips chips={reply.chips.slice(0, 4)} onAsk={onAsk} />}
      </div>
    </div>
  );
}

const noop = () => {};

function HistoryPanel({
  list,
  currentId,
  onOpen,
  onNew,
  onDelete,
}: {
  list: Conversation[];
  currentId: string;
  onOpen: (c: Conversation) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <button
          onClick={onNew}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 hover:border-brand-500 hover:text-brand-700"
        >
          <span aria-hidden className="text-base leading-none">+</span> 새 대화
        </button>
      </div>
      <p className="px-4 pb-1 text-xs font-semibold text-stone-500">최근 대화</p>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {list.length === 0 && <p className="px-2 py-3 text-xs leading-relaxed text-stone-400">아직 이력이 없어요. 검색하면 여기에 쌓여요.</p>}
        <ul className="space-y-0.5">
          {list.map((c) => (
            <li key={c.id} className="group relative">
              <button
                onClick={() => onOpen(c)}
                className={`w-full rounded-lg px-2.5 py-2 pr-8 text-left transition ${c.id === currentId ? 'bg-brand-50 ring-1 ring-brand-100' : 'hover:bg-stone-100'}`}
              >
                <p className={`truncate text-sm ${c.id === currentId ? 'font-medium text-brand-700' : 'text-stone-800'}`}>{c.title}</p>
                <p className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-stone-500">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {/* 어떤 숙소를 찾던 대화인지 */}
                    <span
                      className={`shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${c.state?.category === 'pension' ? 'bg-amber-100 text-amber-800' : 'bg-brand-50 text-brand-700'}`}
                    >
                      {c.state?.category === 'pension' ? '펜션' : '캠핑'}
                    </span>
                    <span className="truncate">{c.summary || '대화 중'}</span>
                  </span>
                  <span className="shrink-0">{relativeTime(c.updatedAt)}</span>
                </p>
              </button>
              <button
                onClick={() => onDelete(c.id)}
                aria-label="이 대화 삭제"
                className="absolute right-1.5 top-2 hidden h-6 w-6 items-center justify-center rounded-md text-stone-400 hover:bg-stone-200 hover:text-stone-700 group-hover:flex"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="border-t border-stone-200 px-4 py-2 text-[11px] leading-relaxed text-stone-400">이력은 이 브라우저에만 저장돼요.</p>
    </div>
  );
}

export default function Home() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [state, setState] = useState<AgentState>(EMPTY);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [exampleTab, setExampleTab] = useState(0); // 첫 화면 예시: 오토캠핑·글램핑·카라반 중 보고 있는 탭
  // 지금 찾는 숙소 종류: 대화 조건에 있으면 그걸, 없으면 상단 탭에서 고른 것
  const [pickedCat, setPickedCat] = useState<'camp' | 'pension'>('camp');
  // 예시를 누르면 바로 보내지 않고 입력창에 채워요. 사용자가 자기 상황에 맞게 고쳐서 보내게.
  const fillExample = (t: string) => {
    setInput(t);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(t.length, t.length);
    });
  };
  // 입력창은 내용 길이에 맞춰 늘어나요 (최대 6줄 정도)
  const fitInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + el.offsetHeight - el.clientHeight, 128)}px`; // 테두리까지 더해야 스크롤바가 안 생겨요
  }, []);
  useEffect(() => {
    fitInput();
    const id = requestAnimationFrame(fitInput); // 레이아웃이 자리 잡은 뒤 한 번 더
    return () => cancelAnimationFrame(id);
  }, [input, fitInput]);
  useEffect(() => {
    window.addEventListener('resize', fitInput);
    document.fonts?.ready.then(fitInput);
    return () => window.removeEventListener('resize', fitInput);
  }, [fitInput]);
  const [busy, setBusy] = useState(false);
  const [convId, setConvId] = useState(newId);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [home, setHome] = useState<HomeT | null>(null);
  const [homeOpen, setHomeOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notice, setNotice] = useState('');
  // 오른쪽 결과 패널: 어느 결과·상세를 볼지, 데스크톱에서 펼칠지, 휴대폰 시트를 열지
  const [view, setView] = useState<{ resultId?: number; detailId?: number; tab: PanelTab }>({ tab: 'results' });
  const [closedTabs, setClosedTabs] = useState<Set<string>>(new Set()); // 닫은 상세 탭 (숙소 id)
  const [showPanel, setShowPanel] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true); // 데스크톱 왼쪽 대화 기록 열고 닫기
  // 데스크톱(lg 이상)에서는 오른쪽 패널, 휴대폰에서는 아래 시트로 결과를 보여 줘요
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const on = () => setIsDesktop(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const pendingAfterHome = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const dirty = useRef(false); // 새로 주고받은 대화가 있을 때만 이력 저장

  // 주소의 ?c=대화ID 로 대화를 열어요 (새로고침·뒤로 가기에도 같은 대화 유지)
  const openFromUrl = useCallback(() => {
    const id = new URLSearchParams(window.location.search).get('c');
    const list = loadConversations();
    const conv = id ? list.find((c) => c.id === id) : undefined;
    dirty.current = false;
    if (conv) {
      setMsgs(conv.msgs);
      setState(conv.state);
      setConvId(conv.id);
      seq.current = Math.max(0, ...conv.msgs.map((m) => m.id));
    } else {
      setMsgs([]);
      setState(EMPTY);
      setConvId(newId());
      if (id) window.history.replaceState(null, '', window.location.pathname); // 없는 대화 주소면 정리
    }
    setView({ tab: 'results' });
    setClosedTabs(new Set());
    setSheetOpen(false);
  }, []);

  useEffect(() => {
    setHistory(loadConversations());
    setHome(loadHome());
    setProfile(loadProfile());
    openFromUrl();
    window.addEventListener('popstate', openFromUrl);
    return () => window.removeEventListener('popstate', openFromUrl);
  }, [openFromUrl]);

  const setUrl = (id: string | null, mode: 'push' | 'replace' = 'push') => {
    const url = id ? `${window.location.pathname}?c=${id}` : window.location.pathname;
    if (url === `${window.location.pathname}${window.location.search}`) return;
    if (mode === 'push') window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  };

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs, busy]);

  // 대화가 바뀔 때마다 이력에 저장 (답변이 하나라도 있을 때만)
  useEffect(() => {
    if (!dirty.current || !msgs.some((m) => m.role === 'agent')) return;
    setHistory((prev) => {
      const { title, summary } = summarize(msgs);
      const conv: Conversation = { id: convId, title, summary, updatedAt: Date.now(), msgs, state };
      const next = [conv, ...prev.filter((c) => c.id !== convId)];
      saveConversations(next);
      return next;
    });
    setUrl(convId, 'replace');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, state, convId]);

  /** 결과를 먼저 보여 준 뒤 상위 곳들의 링크·평점·카카오맵 정보를 받아 그 답의 표에 채워요 */
  const enrich = async (msgId: number, rows: NonNullable<AgentReply['rows']>) => {
    const ids = rows.filter((r) => r.pending).map((r) => r.id);
    let got: { id: string; place?: Row['place']; google?: Row['google']; naver?: Row['naver']; reserve: Row['reserve'] }[] = [];
    try {
      got = (await (await fetch('/api/enrich', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) })).json()).rows ?? [];
    } catch {
      // 못 받아도 표는 그대로 두고 "찾는 중" 표시만 지워요
    }
    const byId = new Map(got.map((g) => [g.id, g]));
    setMsgs((m) =>
      m.map((x) => {
        if (x.id !== msgId || x.role !== 'agent' || !x.reply.rows) return x;
        const rows2 = x.reply.rows.map((r) => {
          const g = byId.get(r.id);
          if (!g) return { ...r, pending: false };
          return { ...r, pending: false, place: g.place ?? r.place, google: g.google, naver: g.naver, reserve: { ...r.reserve, ...g.reserve, mode: g.reserve.mode || r.reserve.mode } };
        });
        return { ...x, reply: { ...x.reply, rows: rows2 } };
      }),
    );
  };

  const ask = useCallback(
    async (text: string, extra?: Places) => {
      const t = text.trim();
      if (!t || busy) return;
      setInput('');
      setBusy(true);
      dirty.current = true;
      setMsgs((m) => [...m, { id: ++seq.current, role: 'user', text: t }]);
      try {
        const res = await fetch('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: t, state, places: { home: home ?? undefined, ...extra }, profile: profile ?? undefined }) });
        const reply = (await res.json()) as AgentReply;
        const id = ++seq.current;
        setState(reply.state);
        setMsgs((m) => [...m, { id, role: 'agent', reply }]);
        if (reply.rows?.some((r) => r.pending)) void enrich(id, reply.rows);
        if (reply.rows?.length && reply.columns) {
          setView({ resultId: id, tab: 'results' });
          setShowPanel(true);
          if (window.innerWidth < 1280) setHistoryOpen(false); // 노트북 폭에서는 결과 자리를 위해 기록을 접어요
        } else if (reply.detail) {
          setView((v) => ({ ...v, detailId: id, tab: 'detail' }));
          // 닫았던 숙소를 다시 상세 보기하면 탭을 다시 열어요
          setClosedTabs((s) => {
            if (!s.has(reply.detail!.id)) return s;
            const n = new Set(s);
            n.delete(reply.detail!.id);
            return n;
          });
          setShowPanel(true);
          if (window.innerWidth < 1024) setSheetOpen(true); // 휴대폰: 상세는 바로 시트로
        }
      } catch {
        setMsgs((m) => [...m, { id: ++seq.current, role: 'agent', reply: { kind: 'message', text: '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.', state, chips: [] } }]);
      } finally {
        setBusy(false);
      }
    },
    [busy, state, home, profile],
  );


  /** 버튼 중 일부는 브라우저에서 먼저 처리해요: 집 주소 등록, 현재 위치 받기 */
  const onChip = useCallback(
    (t: string) => {
      if (t === '우리 집 주소 등록하기') {
        pendingAfterHome.current = true;
        setHomeOpen(true);
        return;
      }
      if (t === '현재 위치에서 출발') {
        if (!navigator.geolocation) {
          setNotice('이 브라우저는 위치 정보를 지원하지 않아요.');
          return;
        }
        setNotice('현재 위치를 확인하는 중…');
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const { latitude: lat, longitude: lng } = pos.coords;
            let label: string | undefined;
            try {
              const r = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`);
              if (r.ok) label = (await r.json()).label;
            } catch {
              /* 동네 이름 없이 진행 */
            }
            setNotice('');
            ask(t, { current: { lat, lng, label } });
          },
          () => setNotice('위치 권한이 거부됐어요. 브라우저 주소창의 위치 아이콘에서 허용해 주세요.'),
          { timeout: 10000 },
        );
        return;
      }
      ask(t);
    },
    [ask],
  );

  const saveHomePlace = (h: HomeT | null) => {
    saveHome(h);
    setHome(h);
    setHomeOpen(false);
    if (h && pendingAfterHome.current) {
      pendingAfterHome.current = false;
      // 저장 직후 바로 이어서 찾기 (home state가 반영되기 전이라 좌표를 직접 넘겨요)
      ask('우리 집에서 출발', { home: { lat: h.lat, lng: h.lng, label: h.label } });
    }
  };

  const category: 'camp' | 'pension' = state.category ?? (msgs.length ? 'camp' : pickedCat);
  const exampleGroups = category === 'pension' ? PENSION_EXAMPLE_GROUPS : EXAMPLE_GROUPS;
  const exTab = Math.min(exampleTab, exampleGroups.length - 1);
  /** 상단 탭: 빈 대화면 종류만 바꾸고, 이미 대화 중이면 그 종류로 새 대화를 열어요 */
  const pickCategory = (k: 'camp' | 'pension') => {
    if (busy || k === category) return;
    setPickedCat(k);
    setExampleTab(0);
    if (msgs.length) {
      dirty.current = false;
      setMsgs([]);
      setConvId(newId());
      setPanelOpen(false);
      setView({ tab: 'results' });
      setClosedTabs(new Set());
      setSheetOpen(false);
      setUrl(null);
    }
    setState({ ...EMPTY, category: k === 'pension' ? 'pension' : undefined });
  };

  const startNew = () => {
    if (busy) return;
    dirty.current = false;
    setMsgs([]);
    setState({ ...EMPTY, category: pickedCat === 'pension' ? 'pension' : undefined });
    setConvId(newId());
    setPanelOpen(false);
    setView({ tab: 'results' });
    setClosedTabs(new Set());
    setSheetOpen(false);
    setUrl(null);
  };

  const open = (c: Conversation) => {
    if (busy) return;
    dirty.current = false;
    setMsgs(c.msgs);
    setState(c.state);
    setConvId(c.id);
    seq.current = Math.max(0, ...c.msgs.map((m) => m.id));
    setPanelOpen(false);
    setView({ tab: 'results' });
    setClosedTabs(new Set());
    setSheetOpen(false);
    setUrl(c.id);
  };

  const remove = (id: string) => {
    setHistory((prev) => {
      const next = prev.filter((c) => c.id !== id);
      saveConversations(next);
      return next;
    });
    if (id === convId) startNew();
  };

  const lastAgentId = [...msgs].reverse().find((m) => m.role === 'agent')?.id;

  // 결과 패널에 올릴 것: 지금 보는 결과(기본은 가장 최근)와 그 결과 이후의 상세
  const agentMsgs = msgs.filter((m): m is AgentMsg => m.role === 'agent');
  const results = agentMsgs.filter((m) => m.reply.rows?.length && m.reply.columns);
  const curResult = results.find((m) => m.id === view.resultId) ?? results[results.length - 1];
  const prevOf = (id?: number) => {
    const i = results.findIndex((m) => m.id === id);
    return i > 0 ? results[i - 1].reply : undefined;
  };
  // 이 대화에서 상세 보기한 숙소들: 같은 숙소는 가장 최근 것만, 닫은 탭은 빼요
  const detailMsgs = agentMsgs.filter((m) => m.reply.detail);
  const details = detailMsgs.filter(
    (m, i) => !closedTabs.has(m.reply.detail!.id) && !detailMsgs.slice(i + 1).some((x) => x.reply.detail!.id === m.reply.detail!.id),
  );
  const curDetail = details.find((m) => m.id === view.detailId) ?? details.find((m) => m.reply.detail!.id === detailMsgs.find((x) => x.id === view.detailId)?.reply.detail!.id) ?? details[details.length - 1];
  const hasPanel = !!(curResult || curDetail);
  const panelVisible = hasPanel && showPanel;
  const openPanel = (next: { resultId?: number; detailId?: number; tab: PanelTab }) => {
    setView(next);
    setShowPanel(true);
    if (window.innerWidth < 1024) setSheetOpen(true);
  };
  const askFromPanel = (t: string) => {
    setSheetOpen(false); // 시트에서 누른 요청은 채팅에서 이어가요 (상세는 다시 시트로 열려요)
    onChip(t);
  };
  const panel = (sheet: boolean) => (
    <ResultPanel
      result={curResult?.reply}
      prev={prevOf(curResult?.id)}
      detail={curDetail?.reply}
      detailTabs={details.map((m) => ({ id: m.id, name: m.reply.detail!.name }))}
      onPickDetail={(id) => setView((v) => ({ ...v, detailId: id, tab: 'detail' }))}
      onCloseDetail={(id) => {
        const campId = details.find((m) => m.id === id)?.reply.detail!.id;
        if (campId) setClosedTabs((s) => new Set(s).add(campId));
        if (curDetail?.id === id) setView((v) => ({ ...v, detailId: undefined, tab: 'results' }));
      }}
      tab={view.tab}
      setTab={(tab) => setView((v) => ({ ...v, tab }))}
      onAsk={sheet ? askFromPanel : onChip}
      onClose={() => (sheet ? setSheetOpen(false) : setShowPanel(false))}
      sheet={sheet}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <header className="relative z-30 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="flex items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => (window.innerWidth >= 1024 ? setHistoryOpen((v) => !v) : setPanelOpen((v) => !v))}
              aria-label={historyOpen ? '대화 기록 닫기' : '대화 기록 열기'}
              title={historyOpen ? '대화 기록 닫기' : '대화 기록 열기'}
              className="-ml-1 rounded-md p-1.5 text-stone-600 hover:bg-stone-100"
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden>
                <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M7.5 3.5v13" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
            <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
              <rect width="32" height="32" rx="9" className="fill-brand-600" />
              {/* 지도 핀 + 지붕: 어떤 숙소든 "머물 곳을 찾아 준다" */}
              <path d="M16 5.5c-4.6 0-8.2 3.5-8.2 8 0 5.8 8.2 13.3 8.2 13.3s8.2-7.5 8.2-13.3c0-4.5-3.6-8-8.2-8z" fill="white" />
              <path d="M11.6 14.6L16 10.8l4.4 3.8" fill="none" className="stroke-brand-600" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M13.2 13.9v3.7h5.6v-3.7" fill="none" className="stroke-brand-600" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <p className="text-[15px] font-bold leading-tight">StayScout</p>
              <p className="hidden text-xs text-stone-500 sm:block">말한 조건 그대로, 갈 수 있는 숙소만</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
          {hasPanel && !panelVisible && (
            <button
              onClick={() => setShowPanel(true)}
              className="hidden items-center gap-1.5 rounded-lg border border-brand-500 px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50 lg:flex"
            >
              추천 후보 열기
            </button>
          )}
          <div className="group relative">
            <button
              onClick={() => setProfileOpen(true)}
              className="flex max-w-[220px] items-center gap-1.5 rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs text-stone-700 hover:border-brand-500 hover:text-brand-700"
              aria-label="내 정보"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" aria-hidden>
                <path d="M3 9.5L10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
              <span className="hidden truncate sm:inline">{home ? `내 정보 · ${home.label}` : '내 정보'}</span>
              {/* 인원·반려견·늘 원하는 조건이 저장돼 있으면 작은 점으로 알려요 */}
              {profileSummary(profile) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" aria-hidden />}
            </button>
            {/* 마우스를 올리면 저장된 내용을 보여 줘요 */}
            <div className="pointer-events-none absolute right-0 top-full z-30 mt-1.5 hidden w-64 rounded-lg border border-stone-200 bg-white p-3 text-xs text-stone-600 shadow-lg group-hover:block">
              {home || profileSummary(profile) ? (
                <>
                  <p className="mb-1 font-semibold text-stone-800">저장된 내 정보</p>
                  <p>
                    <span className="text-stone-400">우리 집</span> {home ? home.address || home.label : '없음'}
                  </p>
                  {(() => {
                    const r = profileRows(profile);
                    return [
                      ['인원·반려견', r.base],
                      ['캠핑장', r.camp],
                      ['펜션·민박', r.pension],
                    ]
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <p key={k} className="mt-0.5">
                          <span className="text-stone-400">{k}</span> {v}
                        </p>
                      ));
                  })()}
                  <p className="mt-1.5 text-[11px] text-stone-400">새 대화를 시작할 때 기본으로 반영돼요</p>
                </>
              ) : (
                <p>우리 집, 같이 가는 인원, 반려견, 늘 원하는 조건을 저장해 두면 새 대화에 기본으로 반영돼요.</p>
              )}
            </div>
          </div>
          <nav className="flex gap-1 rounded-lg bg-stone-100 p-1 text-sm">
            {CATEGORIES.map((c) =>
              c.key ? (
                <button
                  key={c.name}
                  onClick={() => pickCategory(c.key!)}
                  className={
                    category === c.key
                      ? 'whitespace-nowrap rounded-md bg-white px-3 py-1 font-medium shadow-sm'
                      : 'whitespace-nowrap rounded-md px-3 py-1 text-stone-600 hover:text-stone-900'
                  }
                >
                  {c.name}
                </button>
              ) : (
                <span key={c.name} title="카테고리 팩 준비 중" className="hidden cursor-not-allowed whitespace-nowrap px-3 py-1 text-stone-400 sm:inline">
                  {c.name}
                </span>
              ),
            )}
          </nav>
          </div>
        </div>
      </header>
      {profileOpen && (
        <ProfileModal
          initialCat={category}
          profile={profile}
          home={home}
          onSave={(p) => {
            saveProfile(p);
            setProfile(p);
            if (!p) {
              // "내 정보 지우기"는 우리 집 주소까지 지워요
              saveHome(null);
              setHome(null);
            }
            setProfileOpen(false);
          }}
          onEditHome={() => {
            setProfileOpen(false);
            setHomeOpen(true);
          }}
          onClearHome={() => {
            // 우리 집만 지워요 (내 정보 창은 열어 둔 채로)
            saveHome(null);
            setHome(null);
          }}
          onClose={() => setProfileOpen(false)}
        />
      )}
      {homeOpen && <HomeModal home={home} onSave={saveHomePlace} onClose={() => { pendingAfterHome.current = false; setHomeOpen(false); }} />}

      <div className="relative flex min-h-0 flex-1">
        {/* 데스크톱: 고정 사이드바 / 모바일: 슬라이드 패널 */}
        <aside className={`hidden w-64 shrink-0 border-r border-stone-200 bg-stone-50 ${historyOpen ? 'lg:block' : ''}`}>
          <HistoryPanel list={history} currentId={convId} onOpen={open} onNew={startNew} onDelete={remove} />
        </aside>
        {panelOpen && (
          <div className="absolute inset-0 z-20 flex lg:hidden">
            <div className="w-72 border-r border-stone-200 bg-stone-50 shadow-xl">
              <HistoryPanel list={history} currentId={convId} onOpen={open} onNew={startNew} onDelete={remove} />
            </div>
            <button aria-label="닫기" className="flex-1 bg-stone-900/20" onClick={() => setPanelOpen(false)} />
          </div>
        )}

        <div
          className={`flex min-w-0 flex-col ${
            panelVisible ? 'flex-1 lg:w-[420px] lg:flex-none xl:w-[500px] 2xl:w-[600px]' : 'flex-1'
          }`}
        >
          <main className="flex-1 overflow-y-auto">
            <div className={`mx-auto space-y-6 px-5 py-6 ${panelVisible ? 'max-w-3xl' : 'max-w-5xl'}`}>
              {msgs.length === 0 && (
                <section className="rise mx-auto max-w-3xl pt-10 text-center">
                  <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{category === 'pension' ? '어떤 펜션을 찾고 있어요?' : '어떤 캠핑장을 찾고 있어요?'}</h1>
                  <p className="mt-2 text-stone-600">날짜, 인원, 지역, 시설, 분위기까지 생각나는 대로 말해 주세요. 대신 찾아보고 근거와 함께 골라 드릴게요.</p>
                  <div className="mt-8 space-y-4 text-left">
                    <div>
                      <div className="mb-2 flex items-center gap-1">
                        {exampleGroups.map((g, i) => (
                          <button
                            key={g.name}
                            onClick={() => setExampleTab(i)}
                            className={`rounded-full px-3 py-1 text-sm ${exTab === i ? 'bg-stone-800 font-medium text-white' : 'text-stone-600 hover:bg-stone-100'}`}
                          >
                            {g.name}
                          </button>
                        ))}
                      </div>
                      <p className="mb-2 px-1 text-xs text-stone-500">
                        <span className="font-medium text-stone-700">{exampleGroups[exTab].name}</span> · {exampleGroups[exTab].hint}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {exampleGroups[exTab].items.map((e, i, arr) => (
                          <button
                            key={e.text}
                            onClick={() => fillExample(e.text)}
                            className={`group flex flex-col items-start justify-start rounded-xl border border-stone-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-brand-500 ${
                              i === arr.length - 1 && arr.length % 2 === 1 ? 'sm:col-span-2' : ''
                            }`}
                          >
                            <span className="text-xs font-semibold text-brand-700">{e.tag}</span>
                            <span className="mt-1 block text-sm leading-relaxed text-stone-700 group-hover:text-stone-900">{e.text}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {profileSummary(profile, category) && (
                    <p className="mt-4 text-xs text-stone-500">
                      내 정보가 기본으로 반영돼요: <span className="font-medium text-stone-700">{profileSummary(profile, category)}</span>{' '}
                      <button onClick={() => setProfileOpen(true)} className="text-brand-700 hover:underline">
                        수정
                      </button>
                    </p>
                  )}
                  <p className="mt-4 text-xs text-stone-500">예시를 누르면 입력창에 채워져요. 내 상황에 맞게 고쳐서 보내 보세요.</p>
                </section>
              )}

              {msgs.map((m) =>
                m.role === 'user' ? (
                  <div key={`${convId}-${m.id}`} className="rise flex justify-end">
                    <p className="max-w-[80%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-[15px] leading-relaxed text-white">{m.text}</p>
                  </div>
                ) : (
                  <AgentMessage
                    key={`${convId}-${m.id}`}
                    reply={m.reply}
                    latest={m.id === lastAgentId}
                    onAsk={onChip}
                    resultActive={(isDesktop ? panelVisible : sheetOpen) && view.tab === 'results' && curResult?.id === m.id}
                    detailActive={(isDesktop ? panelVisible : sheetOpen) && view.tab === 'detail' && curDetail?.id === m.id}
                    onOpenResult={() => openPanel({ resultId: m.id, tab: 'results' })}
                    onOpenDetail={() => {
                      // 상세가 속한 결과(그 상세 바로 전의 결과)를 같이 올려요
                      const owner = [...results].reverse().find((r) => r.id < m.id);
                      openPanel({ resultId: owner?.id, detailId: m.id, tab: 'detail' });
                    }}
                  />
                ),
              )}

              {notice && <p className="text-center text-xs text-stone-500">{notice}</p>}
              {busy && (
                <div className="flex items-center gap-3 text-sm text-stone-500">
                  <span className="h-8 w-8 rounded-full bg-brand-100" />
                  조건을 정리하고 {category === 'pension' ? '펜션·민박을' : '캠핑장을'} 찾는 중…
                </div>
              )}
              <div ref={bottom} />
            </div>
          </main>

          <footer className="border-t border-stone-200 bg-white">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                ask(input);
              }}
              className={`mx-auto flex items-end gap-2 px-5 py-3 ${panelVisible ? 'max-w-3xl' : 'max-w-5xl'}`}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    ask(input);
                  }
                }}
                rows={1}
                placeholder="예: 다음주 주말 가평, 4명, 바비큐 되고 조용한 곳"
                className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-stone-300 px-4 py-2.5 text-[15px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
              <button disabled={busy || !input.trim()} className="h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40">
                보내기
              </button>
            </form>
            <p className={`mx-auto px-5 pb-3 text-[11px] text-stone-400 ${panelVisible ? 'max-w-3xl' : 'max-w-5xl'}`}>
              데이터: 한국관광공사·행정안전부·산림청 공공데이터, 카카오맵 · Gemini 에이전트가 도구를 골라 처리 (실패 시 기본 순서로 자동 전환) · 이동 시간은 직선거리 기반 추정
            </p>
          </footer>
        </div>

        {/* 데스크톱: 오른쪽 고정 결과 패널 */}
        {panelVisible && (
          <aside className="hidden min-w-[400px] flex-1 border-l border-stone-200 lg:flex lg:flex-col">
            {panel(false)}
          </aside>
        )}
      </div>

      {/* 휴대폰: 아래에서 올라오는 시트 */}
      {sheetOpen && hasPanel && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button aria-label="닫기" className="absolute inset-0 bg-stone-900/30" onClick={() => setSheetOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 h-[85vh] overflow-hidden rounded-t-2xl shadow-2xl">{panel(true)}</div>
        </div>
      )}
    </div>
  );
}
