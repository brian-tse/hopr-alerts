import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/app/lib/supabase';
import {
  scrapeOpenTable,
  getNextDayOfWeek,
  filterSlotsByTimeWindow,
} from '@/app/lib/scraper';
import { sendAvailabilityNotification } from '@/app/lib/notifications';
import type { Alert } from '@/app/lib/types';

// This endpoint triggers an immediate check for a specific alert
export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const { alertId } = await req.json();

    if (!alertId) {
      return NextResponse.json(
        { error: 'Alert ID is required' },
        { status: 400 }
      );
    }

    console.log(`Triggering immediate check for alert ${alertId}`);

    // Fetch the alert
    const { data: alert, error: alertError } = await supabaseAdmin
      .from('hopr_alerts')
      .select('*')
      .eq('id', alertId)
      .single();

    if (alertError || !alert) {
      return NextResponse.json(
        { error: 'Alert not found' },
        { status: 404 }
      );
    }

    const results = [];

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

        // Log this check
        await supabaseAdmin.from('hopr_check_history').insert({
          alert_id: alertId,
          target_date: targetDate,
          slots_found: filteredSlots.length,
          found_slots: filteredSlots,
          error_message: null,
          status: filteredSlots.length > 0 ? 'success' : 'no_availability',
        });

        if (filteredSlots.length > 0) {
          // Send notifications
          const notificationResults = await sendAvailabilityNotification(
            alert as Alert,
            filteredSlots
          );

          const sentCount = notificationResults.filter((r) => r.sent).length;

          results.push({
            day,
            targetDate,
            slotsFound: filteredSlots.length,
            notificationsSent: sentCount,
          });
        } else {
          results.push({
            day,
            targetDate,
            slotsFound: 0,
            notificationsSent: 0,
          });
        }
      } catch (error) {
        console.error(`Error checking ${day} for alert ${alertId}:`, error);

        // Log error
        await supabaseAdmin.from('hopr_check_history').insert({
          alert_id: alertId,
          target_date: getNextDayOfWeek(day),
          slots_found: 0,
          found_slots: null,
          error_message: error instanceof Error ? error.message : 'Unknown error',
          status: 'error',
        });

        results.push({
          day,
          targetDate: getNextDayOfWeek(day),
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      success: true,
      alertId,
      results,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error('Check alert failed:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
