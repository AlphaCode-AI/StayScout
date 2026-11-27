import { NextResponse } from 'next/server';
import { enrichRows } from '@/lib/agent';

export const runtime = 'nodejs';

/** 결과 표를 먼저 보여 준 뒤, 상위 곳들의 링크·평점·카카오맵 정보를 채워요 */
export async function POST(req: Request) {
  const { ids } = (await req.json().catch(() => ({}))) as { ids?: unknown };
  if (!Array.isArray(ids)) return NextResponse.json({ rows: [] });
  const clean = ids.filter((x): x is string => typeof x === 'string').slice(0, 10);
  return NextResponse.json({ rows: clean.length ? await enrichRows(clean) : [] });
}
