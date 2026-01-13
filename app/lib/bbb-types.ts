// TypeScript types for BBB (Bibbidi Bobbidi Boutique) reservation monitoring

export type TimePeriod = 'morning' | 'afternoon' | 'evening';

export type BBBAlert = {
  id: string;
  target_date: string;
  num_guests: number;
  time_preferences: TimePeriod[];
  notify_email: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type BBBCheckHistory = {
  id: string;
  alert_id: string;
  target_date: string;
  time_period: string;
  slots_found: number;
  found_slots: BBBSlot[] | null;
  status: 'success' | 'error' | 'no_availability';
  error_message: string | null;
  checked_at: string;
};

export type BBBNotification = {
  id: string;
  alert_id: string;
  reservation_date: string;
  time_period: string;
  num_guests: number;
  email_to: string;
  sent_at: string;
};

export type BBBSlot = {
  time: string;
  period: TimePeriod;
  available: boolean;
};

export type CreateBBBAlertInput = {
  target_date: string;
  num_guests: number;
  time_preferences: TimePeriod[];
  notify_email: string;
};

export type BBBCheckResult = {
  alert: BBBAlert;
  foundSlots: BBBSlot[];
  notificationsSent: number;
};

// Time period definitions matching Disney's booking system
export const TIME_PERIODS: Record<TimePeriod, { label: string; start: string; end: string }> = {
  morning: { label: 'Morning', start: '08:00', end: '12:00' },
  afternoon: { label: 'Afternoon', start: '12:00', end: '16:00' },
  evening: { label: 'Evening', start: '16:00', end: '18:00' },
};
