/**
 * Standalone scraper script for GitHub Actions
 *
 * This script runs both HOPR and BBB scrapers, fetches alerts from Supabase,
 * and sends notifications via Resend.
 */

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { scrapeOpenTable, getNextDayOfWeek, filterSlotsByTimeWindow } from '../app/lib/scraper';
import { scrapeBBBAvailability } from '../app/lib/bbb-scraper';
import type { Alert, ReservationSlot } from '../app/lib/types';
import type { BBBAlert, BBBSlot } from '../app/lib/bbb-types';

// Initialize clients
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendKey = process.env.RESEND_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

if (!resendKey) {
  console.error('Missing Resend API key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const resend = new Resend(resendKey);

async function runHOPRScraper(): Promise<void> {
  console.log('\n=== Running HOPR Scraper ===\n');
  const startTime = Date.now();

  try {
    // Fetch active HOPR alerts
    const { data: alerts, error } = await supabase
      .from('hopr_alerts')
      .select('*')
      .eq('is_active', true);

    if (error) {
      throw new Error(`Failed to fetch HOPR alerts: ${error.message}`);
    }

    if (!alerts || alerts.length === 0) {
      console.log('No active HOPR alerts found');
      return;
    }

    console.log(`Found ${alerts.length} active HOPR alert(s)`);

    for (const alert of alerts as Alert[]) {
      await processHOPRAlert(alert);
    }
  } catch (error) {
    console.error('HOPR scraper failed:', error);
    // Log error to database
    await supabase.from('hopr_check_history').insert({
      error_message: error instanceof Error ? error.message : 'Unknown error',
      status: 'error',
      duration_ms: Date.now() - startTime,
    });
  }
}

async function processHOPRAlert(alert: Alert): Promise<void> {
  console.log(`\nProcessing HOPR alert ${alert.id} for party of ${alert.party_size}`);

  for (const day of alert.target_days) {
    try {
      const targetDate = getNextDayOfWeek(day);
      console.log(`Checking ${day} (${targetDate})`);

      const allSlots = await scrapeOpenTable({
        partySize: alert.party_size,
        targetDate,
      });

      const filteredSlots = filterSlotsByTimeWindow(
        allSlots,
        alert.window_start,
        alert.window_end
      );

      console.log(`Found ${filteredSlots.length} slot(s) in time window`);

      // Log to history
      await supabase.from('hopr_check_history').insert({
        alert_id: alert.id,
        target_date: targetDate,
        slots_found: filteredSlots.length,
        found_slots: filteredSlots,
        status: filteredSlots.length > 0 ? 'success' : 'no_availability',
      });

      if (filteredSlots.length > 0) {
        await sendHOPRNotifications(alert, filteredSlots);
      }
    } catch (error) {
      console.error(`Error checking ${day}:`, error);
      const targetDate = getNextDayOfWeek(day);
      await supabase.from('hopr_check_history').insert({
        alert_id: alert.id,
        target_date: targetDate,
        slots_found: 0,
        error_message: error instanceof Error ? error.message : 'Unknown error',
        status: 'error',
      });
    }
  }
}

async function sendHOPRNotifications(alert: Alert, slots: ReservationSlot[]): Promise<void> {
  for (const slot of slots) {
    // Check for duplicate notification
    const { data: existing } = await supabase
      .from('hopr_notifications')
      .select('id')
      .eq('alert_id', alert.id)
      .eq('reservation_date', slot.date)
      .eq('reservation_time', slot.time)
      .maybeSingle();

    if (existing) {
      console.log(`Already notified for ${slot.date} at ${slot.time}`);
      continue;
    }

    // Send email
    const { error } = await resend.emails.send({
      from: 'HOPR Alerts <onboarding@resend.dev>',
      to: alert.notify_email,
      subject: 'House of Prime Rib - Reservation Available!',
      html: buildHOPREmailHtml(slot),
    });

    if (error) {
      console.error('Failed to send email:', error);
      continue;
    }

    // Log notification
    await supabase.from('hopr_notifications').insert({
      alert_id: alert.id,
      reservation_date: slot.date,
      reservation_time: slot.time,
      party_size: slot.partySize,
      email_to: alert.notify_email,
    });

    console.log(`Notification sent for ${slot.date} at ${slot.time}`);
  }
}

async function runBBBScraper(): Promise<void> {
  console.log('\n=== Running BBB Scraper ===\n');

  try {
    // Fetch active BBB alerts with future dates
    const today = new Date().toISOString().split('T')[0];
    const { data: alerts, error } = await supabase
      .from('bbb_alerts')
      .select('*')
      .eq('is_active', true)
      .gte('target_date', today);

    if (error) {
      throw new Error(`Failed to fetch BBB alerts: ${error.message}`);
    }

    if (!alerts || alerts.length === 0) {
      console.log('No active BBB alerts found');
      return;
    }

    console.log(`Found ${alerts.length} active BBB alert(s)`);

    for (const alert of alerts as BBBAlert[]) {
      await processBBBAlert(alert);
    }
  } catch (error) {
    console.error('BBB scraper failed:', error);
  }
}

async function processBBBAlert(alert: BBBAlert): Promise<void> {
  console.log(`\nProcessing BBB alert ${alert.id} for ${alert.num_guests} guest(s) on ${alert.target_date}`);

  try {
    const scrapeResults = await scrapeBBBAvailability({
      targetDate: alert.target_date,
      numGuests: alert.num_guests,
      timePeriods: alert.time_preferences,
    });

    const allFoundSlots: BBBSlot[] = [];

    for (const result of scrapeResults) {
      // Log each period check
      await supabase.from('bbb_check_history').insert({
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

    if (allFoundSlots.length > 0) {
      await sendBBBNotifications(alert, allFoundSlots);
    }
  } catch (error) {
    console.error(`Error processing BBB alert ${alert.id}:`, error);
    await supabase.from('bbb_check_history').insert({
      alert_id: alert.id,
      target_date: alert.target_date,
      time_period: 'all',
      slots_found: 0,
      error_message: error instanceof Error ? error.message : 'Unknown error',
      status: 'error',
    });
  }
}

async function sendBBBNotifications(alert: BBBAlert, slots: BBBSlot[]): Promise<void> {
  // Group by period
  const periodSlots = new Map<string, BBBSlot[]>();
  for (const slot of slots) {
    const existing = periodSlots.get(slot.period) || [];
    existing.push(slot);
    periodSlots.set(slot.period, existing);
  }

  for (const [period, periodSlotList] of periodSlots) {
    // Check for duplicate notification
    const { data: existing } = await supabase
      .from('bbb_notifications')
      .select('id')
      .eq('alert_id', alert.id)
      .eq('reservation_date', alert.target_date)
      .eq('time_period', period)
      .maybeSingle();

    if (existing) {
      console.log(`Already notified for ${alert.target_date} ${period}`);
      continue;
    }

    // Send email
    const { error } = await resend.emails.send({
      from: 'BBB Alerts <onboarding@resend.dev>',
      to: alert.notify_email,
      subject: 'Bibbidi Bobbidi Boutique - Reservation Available!',
      html: buildBBBEmailHtml(alert, periodSlotList),
    });

    if (error) {
      console.error('Failed to send email:', error);
      continue;
    }

    // Log notification
    await supabase.from('bbb_notifications').insert({
      alert_id: alert.id,
      reservation_date: alert.target_date,
      time_period: period,
      num_guests: alert.num_guests,
      email_to: alert.notify_email,
    });

    console.log(`Notification sent for ${alert.target_date} ${period}`);
  }
}

function buildHOPREmailHtml(slot: ReservationSlot): string {
  const formattedDate = new Date(slot.date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const bookingUrl = `https://www.opentable.com/house-of-prime-rib-reservations-san-francisco?covers=${slot.partySize}&dateTime=${slot.date}`;

  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family: sans-serif; padding: 20px;">
      <h1 style="color: #667eea;">Reservation Available!</h1>
      <p><strong>House of Prime Rib</strong></p>
      <p>Date: ${formattedDate}</p>
      <p>Time: ${slot.time}</p>
      <p>Party Size: ${slot.partySize}</p>
      <p><a href="${bookingUrl}" style="background: #667eea; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Book Now</a></p>
    </body>
    </html>
  `;
}

function buildBBBEmailHtml(alert: BBBAlert, slots: BBBSlot[]): string {
  const formattedDate = new Date(alert.target_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const periodLabel = slots[0]?.period === 'morning' ? 'Morning' :
    slots[0]?.period === 'afternoon' ? 'Afternoon' : 'Evening';

  const timeList = slots.map(s => s.time).join(', ');
  const bookingUrl = 'https://disneyland.disney.go.com/enchanting-extras-collection/booking-bibbidi-bobbidi-boutique/';

  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family: sans-serif; padding: 20px;">
      <h1 style="color: #ff6b9d;">Reservation Available!</h1>
      <p><strong>Bibbidi Bobbidi Boutique</strong></p>
      <p>Date: ${formattedDate}</p>
      <p>Time Period: ${periodLabel}</p>
      <p>Available Times: ${timeList}</p>
      <p>Guests: ${alert.num_guests}</p>
      <p><a href="${bookingUrl}" style="background: #ff6b9d; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Book Now</a></p>
    </body>
    </html>
  `;
}

// Main execution
async function main() {
  console.log('Starting scraper run at', new Date().toISOString());

  // Run both scrapers
  await runHOPRScraper();
  await runBBBScraper();

  console.log('\nScraper run completed at', new Date().toISOString());
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
