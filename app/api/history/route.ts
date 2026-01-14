import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/app/lib/supabase';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const alertId = searchParams.get('alertId');

  try {
    let query = supabaseAdmin
      .from('hopr_check_history')
      .select('*')
      .order('check_time', { ascending: false })
      .limit(20);

    // Filter by alert_id if provided
    if (alertId) {
      query = query.eq('alert_id', alertId);
    }

    const { data: history, error } = await query;

    if (error) {
      console.error('Error fetching check history:', error);
      return NextResponse.json(
        { error: 'Failed to fetch history' },
        { status: 500 }
      );
    }

    return NextResponse.json({ history: history || [] });
  } catch (error) {
    console.error('Unexpected error fetching history:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
