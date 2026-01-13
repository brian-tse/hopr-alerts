import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/app/lib/supabase';
import {
  scrapeOpenTable,
  getNextDayOfWeek,
  filterSlotsByTimeWindow,
} from '@/app/lib/scraper';
import { sendAvailabilityNotification } from '@/app/lib/notifications';
import type { Alert, CheckResult } from '@/app/lib/types';

// This endpoint is triggered by Vercel Cron every 15 minutes
export async function GET(req: NextRequest) {
  const startTime = Date.now();

  // Verify cron secret for security
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('Starting cron job: checking OpenTable availability');

    // Fetch all active alerts
    const { data: alerts, error: alertsError } = await supabaseAdmin
      .from('hopr_alerts')
      .select('*')
      .eq('is_active', true);

    if (alertsError) {
      throw new Error(`Failed to fetch alerts: ${alertsError.message}`);
    }

    if (!alerts || alerts.length === 0) {
      console.log('No active alerts found');
      await logCheckHistory([], null, Date.now() - startTime);
      return NextResponse.json({
        success: true,
        message: 'No active alerts',
        checked: 0,
      });
    }

    console.log(`Found ${alerts.length} active alert(s)`);

    // Process each alert
    const results: CheckResult[] = [];

    for (const alert of alerts as Alert[]) {
      try {
        const alertResults = await processAlert(alert);
        results.push(...alertResults);
      } catch (error) {
        console.error(`Error processing alert ${alert.id}:`, error);
        // Continue with other alerts even if one fails
      }
    }

    // Log successful check
    const totalSlots = results.reduce((sum, r) => sum + r.foundSlots.length, 0);
    await logCheckHistory(
      results.flatMap((r) => r.foundSlots),
      null,
      Date.now() - startTime
    );

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
    console.error('Cron job failed:', error);

    // Log failed check
    await logCheckHistory(
      [],
      error instanceof Error ? error.message : 'Unknown error',
      Date.now() - startTime
    );

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

async function processAlert(alert: Alert): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Check each target day
  for (const day of alert.target_days) {
    try {
      const targetDate = getNextDayOfWeek(day);

      console.log(
        `Checking ${day} (${targetDate}) for party of ${alert.party_size}`
      );

      // Scrape OpenTable
      const allSlots = await scrapeOpenTable({
        partySize: alert.party_size,
        targetDate,
      });

      // Filter by time window
      const filteredSlots = filterSlotsByTimeWindow(
        allSlots,
        alert.window_start,
        alert.window_end
      );

      console.log(
        `Found ${filteredSlots.length} slot(s) in time window ${alert.window_start}-${alert.window_end}`
      );

      if (filteredSlots.length > 0) {
        // Send notifications
        const notificationResults = await sendAvailabilityNotification(
          alert,
          filteredSlots
        );

        const sentCount = notificationResults.filter((r) => r.sent).length;

        results.push({
          alert,
          foundSlots: filteredSlots,
          notificationsSent: sentCount,
        });
      } else {
        results.push({
          alert,
          foundSlots: [],
          notificationsSent: 0,
        });
      }
    } catch (error) {
      console.error(`Error checking ${day} for alert ${alert.id}:`, error);
      // Continue with other days even if one fails
    }
  }

  return results;
}

async function logCheckHistory(
  foundSlots: any[],
  errorMessage: string | null,
  durationMs: number
) {
  try {
    await supabaseAdmin.from('hopr_check_history').insert({
      found_slots: foundSlots,
      error_message: errorMessage,
      duration_ms: durationMs,
      status: errorMessage
        ? 'error'
        : foundSlots.length > 0
        ? 'success'
        : 'no_availability',
    });
  } catch (error) {
    console.error('Failed to log check history:', error);
    // Don't throw - logging failure shouldn't stop the cron job
  }
}
