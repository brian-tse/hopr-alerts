import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/app/lib/supabase';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const alertId = searchParams.get('alertId');

  if (!alertId) {
    return NextResponse.json(
      { error: 'alertId is required' },
      { status: 400 }
    );
  }

  // Get check history for this alert
  const { data: history, error } = await supabaseAdmin
    .from('hopr_check_history')
    .select('*')
    .eq('alert_id', alertId)
    .order('checked_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error fetching check history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch history' },
      { status: 500 }
    );
  }

  return NextResponse.json({ history });
}
