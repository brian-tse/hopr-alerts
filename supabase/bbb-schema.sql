-- Bibbidi Bobbidi Boutique (BBB) Alert Tables
-- Run this SQL in Supabase SQL Editor

-- BBB Alerts Table
CREATE TABLE bbb_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_date DATE NOT NULL,
  num_guests INTEGER NOT NULL CHECK (num_guests >= 1 AND num_guests <= 10),
  time_preferences TEXT[] NOT NULL DEFAULT ARRAY['morning', 'afternoon', 'evening'],
  notify_email TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Check History Table (audit trail)
CREATE TABLE bbb_check_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID REFERENCES bbb_alerts(id) ON DELETE CASCADE,
  target_date DATE NOT NULL,
  time_period TEXT NOT NULL,
  slots_found INTEGER DEFAULT 0,
  found_slots JSONB,
  status TEXT NOT NULL, -- 'success', 'error', 'no_availability'
  error_message TEXT,
  checked_at TIMESTAMPTZ DEFAULT now()
);

-- Notification Deduplication Table
CREATE TABLE bbb_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID REFERENCES bbb_alerts(id) ON DELETE CASCADE,
  reservation_date DATE NOT NULL,
  time_period TEXT NOT NULL,
  num_guests INTEGER NOT NULL,
  email_to TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(alert_id, reservation_date, time_period)
);

-- Indexes for performance
CREATE INDEX idx_bbb_alerts_active ON bbb_alerts(is_active);
CREATE INDEX idx_bbb_alerts_target_date ON bbb_alerts(target_date);
CREATE INDEX idx_bbb_check_history_alert ON bbb_check_history(alert_id);
CREATE INDEX idx_bbb_check_history_checked_at ON bbb_check_history(checked_at);

-- Enable Row Level Security
ALTER TABLE bbb_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bbb_check_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE bbb_notifications ENABLE ROW LEVEL SECURITY;

-- Permissive policies (for personal use - allows all operations)
CREATE POLICY "Allow all on bbb_alerts" ON bbb_alerts FOR ALL USING (true);
CREATE POLICY "Allow all on bbb_check_history" ON bbb_check_history FOR ALL USING (true);
CREATE POLICY "Allow all on bbb_notifications" ON bbb_notifications FOR ALL USING (true);
