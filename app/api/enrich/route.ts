import { NextResponse } from 'next/server';
import { enrichRows } from '@/lib/agent';

export const runtime = 'nodejs';

/** 결과 표를 먼저 보여 준 뒤, 상위 곳들의 링크·평점·카카오맵 정보를 채워요 */
export async function POST(req: Request) {
  const { items } = (await req.json()) as { items?: { id: string; url?: string; mode?: string }[] };
  if (!Array.isArray(items) || !items.length) return NextResponse.json({ rows: [] });
  return NextResponse.json({ rows: await enrichRows(items) });
}
