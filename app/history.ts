'use client';

import type { AgentReply, AgentState } from '@/lib/types';

export type Msg = { id: number; role: 'user'; text: string } | { id: number; role: 'agent'; reply: AgentReply };

export interface Conversation {
  id: string;
  title: string;
  summary: string;
  updatedAt: number;
  msgs: Msg[];
  state: AgentState;
}

const KEY = 'stayscout:conversations:v1';
const MAX = 30;

/** 브라우저(localStorage)에 대화 이력을 저장해요. 다른 기기와는 공유되지 않아요. */
export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Conversation[]) : [];
    return Array.isArray(list) ? list.sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // 저장 공간이 부족하면 오래된 대화부터 줄여서 다시 시도해요.
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, 10)));
    } catch {
      /* 저장하지 못해도 화면 동작에는 영향 없음 */
    }
  }
}

export function summarize(msgs: Msg[]): { title: string; summary: string } {
  const firstUser = msgs.find((m) => m.role === 'user') as Extract<Msg, { role: 'user' }> | undefined;
  const title = firstUser ? (firstUser.text.length > 34 ? `${firstUser.text.slice(0, 34)}…` : firstUser.text) : '새 대화';
  const lastResult = [...msgs].reverse().find((m) => m.role === 'agent' && m.reply.kind === 'result') as
    | Extract<Msg, { role: 'agent' }>
    | undefined;
  if (!lastResult) {
    const lastAgent = [...msgs].reverse().find((m) => m.role === 'agent') as Extract<Msg, { role: 'agent' }> | undefined;
    return { title, summary: lastAgent?.reply.kind === 'ask' ? '추가 정보를 기다리는 중' : '' };
  }
  const s = lastResult.reply.state;
  const place = s.regions.length
    ? s.regions.map((r) => r.replace(/(특별자치도|특별시|광역시|시|군)$/, '')).join('·')
    : s.origin && s.maxMinutes
      ? `${s.origin}에서 ${Math.round((s.maxMinutes / 60) * 10) / 10}시간`
      : '전국';
  return { title, summary: `${place} · ${(lastResult.reply.total ?? 0).toLocaleString()}곳` };
}

export function relativeTime(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '방금';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export interface Home {
  lat: number;
  lng: number;
  label: string;
  address: string;
}

const HOME_KEY = 'stayscout:home:v1';

/** 우리 집 좌표는 이 브라우저에만 저장해요. 검색할 때 좌표만 서버로 보내고, 서버는 저장하지 않아요. */
export function loadHome(): Home | null {
  try {
    const raw = localStorage.getItem(HOME_KEY);
    if (!raw) return null;
    const h = JSON.parse(raw) as Home;
    // 예전에 번지까지 저장된 주소는 동네까지만 남기고 좌표도 약 1km 단위로 뭉개요
    const t = (h.address || '').trim().split(/\s+/);
    while (t.length > 2 && /\d|^산$|^지하$/.test(t[t.length - 1])) t.pop();
    const slim: Home = { ...h, address: t.join(' '), lat: Math.round(h.lat * 100) / 100, lng: Math.round(h.lng * 100) / 100 };
    if (slim.address !== h.address || slim.lat !== h.lat || slim.lng !== h.lng) localStorage.setItem(HOME_KEY, JSON.stringify(slim));
    return slim;
  } catch {
    return null;
  }
}

export function saveHome(home: Home | null) {
  try {
    if (home) localStorage.setItem(HOME_KEY, JSON.stringify(home));
    else localStorage.removeItem(HOME_KEY);
  } catch {
    /* 저장 실패는 무시 */
  }
}

const PROFILE_KEY = 'stayscout:profile:v1';

/** 내 정보(인원·반려견·늘 원하는 조건)도 이 브라우저에만 저장해요. */
export function loadProfile(): import('@/lib/profile').Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveProfile(p: import('@/lib/profile').Profile | null) {
  try {
    if (p) localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* 저장 실패는 무시 */
  }
}
