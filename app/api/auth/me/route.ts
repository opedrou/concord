// GET /api/auth/me
// 200: { username: string, isAdmin: boolean }
// 401: { error: 'not_authenticated' }
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ('response' in auth) return auth.response;

  return NextResponse.json({ username: auth.user.username, isAdmin: auth.user.isAdmin });
}
