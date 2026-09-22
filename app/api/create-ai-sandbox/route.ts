import { NextResponse } from 'next/server';
import { pilotRoute } from '@/lib/aidaos/pilot-route';
// Legacy E2B creation cannot establish an owned Vercel pilot session.
export const POST = pilotRoute(async () => NextResponse.json({error: 'Use the authenticated Vercel builder'}, {status: 410}));
