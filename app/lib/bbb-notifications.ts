import { Resend } from 'resend';
import { supabaseAdmin } from './supabase';
import type { BBBSlot, BBBAlert, TIME_PERIODS } from './bbb-types';

const resend = new Resend(process.env.RESEND_API_KEY);

export interface NotificationResult {
  sent: boolean;
  notificationId?: string;
  error?: string;
}

export async function sendBBBNotification(
  alert: BBBAlert,
  slots: BBBSlot[]
): Promise<NotificationResult[]> {
  const results: NotificationResult[] = [];

  // Group slots by period for deduplication
  const periodSlots = new Map<string, BBBSlot[]>();
  for (const slot of slots) {
    const existing = periodSlots.get(slot.period) || [];
    existing.push(slot);
    periodSlots.set(slot.period, existing);
  }

  for (const [period, periodSlotList] of periodSlots) {
    try {
      // Check if we've already sent a notification for this period
      const { data: existing } = await supabaseAdmin
        .from('bbb_notifications')
        .select('id')
        .eq('alert_id', alert.id)
        .eq('reservation_date', alert.target_date)
        .eq('time_period', period)
        .single();

      if (existing) {
        console.log(
          `Already notified for ${alert.target_date} ${period}, skipping`
        );
        results.push({ sent: false, error: 'Already notified' });
        continue;
      }

      // Build the booking URL
      const bookingUrl = buildBookingUrl(alert.target_date);

      // Send email notification
      const { data, error } = await resend.emails.send({
        from: 'BBB Alerts <onboarding@resend.dev>',
        to: alert.notify_email,
        subject: `Bibbidi Bobbidi Boutique - Reservation Available!`,
        html: buildEmailHtml(alert, periodSlotList, bookingUrl),
      });

      if (error) {
        console.error('Error sending email:', error);
        results.push({ sent: false, error: error.message });
        continue;
      }

      // Log the notification in database
      await supabaseAdmin.from('bbb_notifications').insert({
        alert_id: alert.id,
        reservation_date: alert.target_date,
        time_period: period,
        num_guests: alert.num_guests,
        email_to: alert.notify_email,
      });

      console.log(`Notification sent for ${alert.target_date} ${period}`);
      results.push({ sent: true, notificationId: data?.id });
    } catch (error) {
      console.error('Unexpected error sending notification:', error);
      results.push({
        sent: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}

function buildBookingUrl(targetDate: string): string {
  return 'https://disneyland.disney.go.com/enchanting-extras-collection/booking-bibbidi-bobbidi-boutique/';
}

function buildEmailHtml(alert: BBBAlert, slots: BBBSlot[], bookingUrl: string): string {
  const formattedDate = new Date(alert.target_date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const periodLabel = slots[0]?.period === 'morning' ? 'Morning' :
    slots[0]?.period === 'afternoon' ? 'Afternoon' : 'Evening';

  const timeList = slots.map(s => s.time).join(', ');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>BBB Reservation Available</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #ff6b9d 0%, #c44569 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
        <h1 style="margin: 0; font-size: 24px;">Reservation Available!</h1>
        <p style="margin: 10px 0 0 0; font-size: 18px;">Bibbidi Bobbidi Boutique</p>
      </div>

      <div style="background: #fff5f7; padding: 30px; border-radius: 0 0 10px 10px;">
        <p style="font-size: 16px; margin-top: 0;">Great news! A reservation matching your criteria is now available:</p>

        <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #ff6b9d; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-weight: 600; color: #c44569;">Date:</td>
              <td style="padding: 8px 0;">${formattedDate}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: 600; color: #c44569;">Time Period:</td>
              <td style="padding: 8px 0;">${periodLabel}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: 600; color: #c44569;">Available Times:</td>
              <td style="padding: 8px 0;">${timeList}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: 600; color: #c44569;">Guests:</td>
              <td style="padding: 8px 0;">${alert.num_guests} child${alert.num_guests > 1 ? 'ren' : ''}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${bookingUrl}"
             style="display: inline-block; background: linear-gradient(135deg, #ff6b9d 0%, #c44569 100%); color: white; text-decoration: none; padding: 15px 40px; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            Book Now on Disney
          </a>
        </div>

        <p style="font-size: 14px; color: #666; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
          <strong>Note:</strong> Reservations fill up quickly! Click the button above to book immediately.
        </p>

        <p style="font-size: 12px; color: #999; margin-top: 20px; text-align: center;">
          This is an automated notification from BBB Alerts. You're receiving this because you set up an alert for Bibbidi Bobbidi Boutique reservations.
        </p>
      </div>
    </body>
    </html>
  `;
}
