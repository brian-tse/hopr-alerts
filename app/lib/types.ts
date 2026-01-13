// TypeScript types for the HOPR reservation monitoring system

export type Alert = {
  id: string;
  party_size: number;
  target_days: string[];
  window_start: string;
  window_end: string;
  notify_email: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CheckHistory = {
  id: string;
  alert_id: string;
  checked_at: string;
  target_date: string;
  slots_found: number;
  found_slots: ReservationSlot[] | null;
  error_message: string | null;
  status: 'success' | 'error' | 'no_availability';
};

export type Notification = {
  id: string;
  alert_id: string;
  reservation_date: string;
  reservation_time: string;
  party_size: number;
  sent_at: string;
  email_to: string;
};

export type ReservationSlot = {
  date: string;
  time: string;
  partySize: number;
  available: boolean;
};

export type CreateAlertInput = {
  party_size: number;
  target_days: string[];
  window_start: string;
  window_end: string;
  notify_email: string;
};

export type UpdateAlertInput = {
  party_size?: number;
  target_days?: string[];
  window_start?: string;
  window_end?: string;
  notify_email?: string;
  is_active?: boolean;
};

export type CheckResult = {
  alert: Alert;
  foundSlots: ReservationSlot[];
  notificationsSent: number;
};
