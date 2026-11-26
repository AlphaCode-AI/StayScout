import { NextResponse } from 'next/server';
import { runAgent } from '@/lib/agent';
import type { AgentState, Places } from '@/lib/types';
import type { Profile } from '@/lib/profile';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { text, state, places, profile } = (await req.json()) as { text: string; state?: AgentState; places?: Places; profile?: Profile };
  const reply = await runAgent(String(text || ''), state ?? { regions: [], conds: [] }, places, profile);
  return NextResponse.json(reply);
}
