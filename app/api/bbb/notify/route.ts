import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/app/lib/supabase';
import { sendBBBNotification } from '@/app/lib/bbb-notifications';
import type { BBBAlert, BBBSlot, TimePeriod } from '@/app/lib/bbb-types';

// POST /api/bbb/notify - Called by GitHub Actions after scraping
// Body: { alertId, slots: [{ time, period }] }
export async function POST(req: NextRequest) {
  // Verify cron secret for security
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { alertId, slots, timePeriod, error: scrapeError } = body;

    if (!alertId) {
      return NextResponse.json({ error: 'alertId is required' }, { status: 400 });
    }

    // Fetch the alert
    const { data: alert, error: alertError } = await supabaseAdmin
      .from('bbb_alerts')
      .select('*')
      .eq('id', alertId)
      .single();

    if (alertError || !alert) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    const bbbAlert = alert as BBBAlert;

    // Log the check to history
    await supabaseAdmin.from('bbb_check_history').insert({
      alert_id: alertId,
      target_date: bbbAlert.target_date,
      time_period: timePeriod || 'all',
      slots_found: slots?.length || 0,
      found_slots: slots || null,
      error_message: scrapeError || null,
      status: scrapeError ? 'error' : (slots?.length > 0 ? 'success' : 'no_availability'),
    });

    // If slots found, send notification
    let notificationsSent = 0;
    if (slots && slots.length > 0) {
      const bbbSlots: BBBSlot[] = slots.map((s: any) => ({
        time: s.time,
        period: s.period as TimePeriod,
        available: true,
      }));

      const results = await sendBBBNotification(bbbAlert, bbbSlots);
      notificationsSent = results.filter(r => r.sent).length;
    }

    return NextResponse.json({
      success: true,
      alertId,
      slotsFound: slots?.length || 0,
      notificationsSent,
    });
  } catch (error) {
    console.error('Error in notify endpoint:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// GET /api/bbb/notify - Get active alerts for GitHub Actions to process
export async function GET(req: NextRequest) {
  // Verify cron secret for security
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch all active alerts where target_date is today or in the future
    const today = new Date().toISOString().split('T')[0];
    const { data: alerts, error } = await supabaseAdmin
      .from('bbb_alerts')
      .select('*')
      .eq('is_active', true)
      .gte('target_date', today);

    if (error) {
      throw new Error(`Failed to fetch alerts: ${error.message}`);
    }

    return NextResponse.json({ alerts: alerts || [] });
  } catch (error) {
    console.error('Error fetching alerts:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
