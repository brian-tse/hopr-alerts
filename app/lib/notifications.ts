import { Resend } from 'resend';
import { supabaseAdmin } from './supabase';
import type { ReservationSlot, Alert } from './types';

const resend = new Resend(process.env.RESEND_API_KEY);

export interface NotificationResult {
  sent: boolean;
  notificationId?: string;
  error?: string;
}

export async function sendAvailabilityNotification(
  alert: Alert,
  slots: ReservationSlot[]
): Promise<NotificationResult[]> {
  const results: NotificationResult[] = [];

  for (const slot of slots) {
    try {
      // Check if we've already sent a notification for this slot
      const { data: existing } = await supabaseAdmin
        .from('hopr_notifications')
        .select('id')
        .eq('alert_id', alert.id)
        .eq('reservation_date', slot.date)
        .eq('reservation_time', slot.time)
        .maybeSingle();

      if (existing) {
        console.log(
          `Already notified for ${slot.date} at ${slot.time}, skipping`
        );
        results.push({ sent: false, error: 'Already notified' });
        continue;
      }

      // Build the booking URL
      const bookingUrl = buildBookingUrl(slot);

      // Send email notification
      const { data, error } = await resend.emails.send({
        from: 'HOPR Alerts <onboarding@resend.dev>',
        to: alert.notify_email,
        subject: `House of Prime Rib - Reservation Available!`,
        html: buildEmailHtml(slot, bookingUrl),
      });

      if (error) {
        console.error('Error sending email:', error);
        results.push({ sent: false, error: error.message });
        continue;
      }

      // Log the notification in database
      await supabaseAdmin.from('hopr_notifications').insert({
        alert_id: alert.id,
        reservation_date: slot.date,
        reservation_time: slot.time,
        party_size: slot.partySize,
        email_to: alert.notify_email,
      });

      console.log(`Notification sent for ${slot.date} at ${slot.time}`);
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

function buildBookingUrl(slot: ReservationSlot): string {
  const baseUrl =
    process.env.HOPR_RESTAURANT_URL ||
    'https://www.opentable.com/house-of-prime-rib-reservations-san-francisco';

  // Parse time to get hours and minutes
  const timeMatch = slot.time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!timeMatch) return baseUrl;

  let hours = parseInt(timeMatch[1]);
  const minutes = timeMatch[2];
  const meridiem = timeMatch[3]?.toUpperCase();

  if (meridiem === 'PM' && hours !== 12) {
    hours += 12;
  } else if (meridiem === 'AM' && hours === 12) {
    hours = 0;
  }

  const time24 = `${hours.toString().padStart(2, '0')}:${minutes}`;

  return `${baseUrl}?covers=${slot.partySize}&dateTime=${slot.date}T${time24}`;
}

function buildEmailHtml(slot: ReservationSlot, bookingUrl: string): string {
  const formattedDate = new Date(slot.date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Reservation Available</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
        <h1 style="margin: 0; font-size: 28px;">Reservation Available!</h1>
        <p style="margin: 10px 0 0 0; font-size: 18px;">House of Prime Rib</p>
      </div>

      <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
        <p style="font-size: 16px; margin-top: 0;">Great news! A reservation matching your criteria is now available:</p>

        <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #667eea; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; font-weight: 600; color: #667eea;">Date:</td>
              <td style="padding: 8px 0;">${formattedDate}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: 600; color: #667eea;">Time:</td>
              <td style="padding: 8px 0;">${slot.time}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: 600; color: #667eea;">Party Size:</td>
              <td style="padding: 8px 0;">${slot.partySize} people</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${bookingUrl}"
             style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 15px 40px; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            Book Now on OpenTable
          </a>
        </div>

        <p style="font-size: 14px; color: #666; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
          <strong>Note:</strong> Reservations fill up quickly! Click the button above to book immediately.
        </p>

        <p style="font-size: 12px; color: #999; margin-top: 20px; text-align: center;">
          This is an automated notification from HOPR Alerts. You're receiving this because you set up an alert for House of Prime Rib reservations.
        </p>
      </div>
    </body>
    </html>
  `;
}
