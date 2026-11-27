import { NextResponse } from 'next/server';
import { enrichRows } from '@/lib/agent';

export const runtime = 'nodejs';

/** 결과 표를 먼저 보여 준 뒤, 상위 곳들의 링크·평점·카카오맵 정보를 채워요 */
export async function POST(req: Request) {
  const { ids, trip } = (await req.json().catch(() => ({}))) as { ids?: unknown; trip?: Record<string, unknown> };
  if (!Array.isArray(ids)) return NextResponse.json({ rows: [] });
  const clean = ids.filter((x): x is string => typeof x === 'string').slice(0, 10);
  // 이동 시간 계산용: 출발지(이름 또는 좌표), 체크인 날짜, 이동 시간 조건
  const c = Array.isArray(trip?.originCoords) ? trip.originCoords.map(Number) : [];
  const t = {
    origin: typeof trip?.origin === 'string' ? trip.origin : undefined,
    originCoords: c.length === 2 && c.every((x) => Number.isFinite(x) && Math.abs(x) <= 180) ? ([c[0], c[1]] as [number, number]) : undefined,
    checkIn: typeof trip?.checkIn === 'string' ? trip.checkIn : undefined,
    maxMinutes: Number(trip?.maxMinutes) || undefined,
  };
  return NextResponse.json({ rows: clean.length ? await enrichRows(clean, t) : [] });
}
