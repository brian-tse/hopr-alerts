import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/app/lib/supabase';
import type { BBBCheckHistory } from '@/app/lib/bbb-types';

// GET /api/bbb/history?alertId=xxx - Fetch check history for an alert
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const alertId = searchParams.get('alertId');

    if (!alertId) {
      return NextResponse.json(
        { error: 'Alert ID is required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('bbb_check_history')
      .select('*')
      .eq('alert_id', alertId)
      .order('checked_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('Error fetching BBB history:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ history: data as BBBCheckHistory[] });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
