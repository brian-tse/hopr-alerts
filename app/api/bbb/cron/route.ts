import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/app/lib/supabase';
import { scrapeBBBAvailability } from '@/app/lib/bbb-scraper';
import { sendBBBNotification } from '@/app/lib/bbb-notifications';
import type { BBBAlert, BBBCheckResult, BBBSlot } from '@/app/lib/bbb-types';

// This endpoint is triggered by Vercel Cron every 15 minutes
export async function GET(req: NextRequest) {
  const startTime = Date.now();

  // Verify cron secret for security
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('Starting BBB cron job: checking Disney availability');

    // Fetch all active alerts where target_date is today or in the future
    const today = new Date().toISOString().split('T')[0];
    const { data: alerts, error: alertsError } = await supabaseAdmin
      .from('bbb_alerts')
      .select('*')
      .eq('is_active', true)
      .gte('target_date', today);

    if (alertsError) {
      throw new Error(`Failed to fetch alerts: ${alertsError.message}`);
    }

    if (!alerts || alerts.length === 0) {
      console.log('No active BBB alerts found');
      return NextResponse.json({
        success: true,
        message: 'No active alerts',
        checked: 0,
      });
    }

    console.log(`Found ${alerts.length} active BBB alert(s)`);

    // Process each alert
    const results: BBBCheckResult[] = [];

    for (const alert of alerts as BBBAlert[]) {
      try {
        const alertResult = await processAlert(alert);
        results.push(alertResult);
      } catch (error) {
        console.error(`Error processing BBB alert ${alert.id}:`, error);
        // Log error to history
        await supabaseAdmin.from('bbb_check_history').insert({
          alert_id: alert.id,
          target_date: alert.target_date,
          time_period: 'all',
          slots_found: 0,
          found_slots: null,
          error_message: error instanceof Error ? error.message : 'Unknown error',
          status: 'error',
        });
      }
    }

    const totalSlots = results.reduce((sum, r) => sum + r.foundSlots.length, 0);

    return NextResponse.json({
      success: true,
      checked: alerts.length,
      totalSlotsFound: totalSlots,
      results: results.map((r) => ({
        alertId: r.alert.id,
        slotsFound: r.foundSlots.length,
        notificationsSent: r.notificationsSent,
      })),
    });
  } catch (error) {
    console.error('BBB cron job failed:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

async function processAlert(alert: BBBAlert): Promise<BBBCheckResult> {
  console.log(
    `Checking BBB for ${alert.num_guests} guest(s) on ${alert.target_date}, periods: ${alert.time_preferences.join(', ')}`
  );

  // Scrape Disney
  const scrapeResults = await scrapeBBBAvailability({
    targetDate: alert.target_date,
    numGuests: alert.num_guests,
    timePeriods: alert.time_preferences,
  });

  // Collect all found slots and log each period
  const allFoundSlots: BBBSlot[] = [];

  for (const result of scrapeResults) {
    // Log this check to history
    await supabaseAdmin.from('bbb_check_history').insert({
      alert_id: alert.id,
      target_date: alert.target_date,
      time_period: result.period,
      slots_found: result.slots.length,
      found_slots: result.slots,
      error_message: result.error || null,
      status: result.error ? 'error' : result.slots.length > 0 ? 'success' : 'no_availability',
    });

    if (result.slots.length > 0) {
      allFoundSlots.push(...result.slots);
    }
  }

  console.log(`Found ${allFoundSlots.length} total slot(s) for alert ${alert.id}`);

  let notificationsSent = 0;
  if (allFoundSlots.length > 0) {
    // Send notifications
    const notificationResults = await sendBBBNotification(alert, allFoundSlots);
    notificationsSent = notificationResults.filter((r) => r.sent).length;
  }

  return {
    alert,
    foundSlots: allFoundSlots,
    notificationsSent,
  };
}
