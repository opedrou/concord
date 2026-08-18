// POST /api/auth/logout
// 200: { ok: true }   + Set-Cookie que zera a sessão
import { NextResponse } from 'next/server';
import { buildLogoutCookie } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json({ ok: true }, { status: 200, headers: { 'Set-Cookie': buildLogoutCookie() } });
}
