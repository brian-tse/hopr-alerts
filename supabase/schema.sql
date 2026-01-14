-- House of Prime Rib Reservation Monitor Database Schema

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Main alerts table - stores user preferences for notifications
create table public.hopr_alerts (
  id uuid primary key default uuid_generate_v4(),
  party_size int not null check (party_size in (4, 6, 8)),
  target_days text[] not null check (target_days <@ ARRAY['Friday', 'Saturday']),
  window_start time not null default '16:00:00',
  window_end time not null default '20:00:00',
  notify_email text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Check history table - logs every check attempt for monitoring and debugging
create table public.hopr_check_history (
  id uuid primary key default uuid_generate_v4(),
  alert_id uuid references hopr_alerts(id) on delete cascade,
  target_date date,
  slots_found int default 0,
  check_time timestamptz not null default now(),
  found_slots jsonb not null default '[]'::jsonb,
  error_message text,
  duration_ms int,
  status text not null check (status in ('success', 'error', 'no_availability'))
);

-- Notification log - tracks what we've sent to prevent duplicates
create table public.hopr_notifications (
  id uuid primary key default uuid_generate_v4(),
  alert_id uuid references hopr_alerts(id) on delete cascade,
  reservation_date date not null,
  reservation_time time not null,
  party_size int not null,
  sent_at timestamptz not null default now(),
  email_to text not null,
  unique(alert_id, reservation_date, reservation_time)
);

-- Indexes for performance
create index idx_hopr_alerts_active on hopr_alerts(is_active) where is_active = true;
create index idx_hopr_check_history_time on hopr_check_history(check_time desc);
create index idx_hopr_notifications_alert on hopr_notifications(alert_id, reservation_date);

-- Function to automatically update updated_at timestamp
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Trigger to update updated_at on hopr_alerts
create trigger update_hopr_alerts_updated_at
  before update on hopr_alerts
  for each row
  execute function update_updated_at_column();

-- Row Level Security (RLS)
alter table hopr_alerts enable row level security;
alter table hopr_check_history enable row level security;
alter table hopr_notifications enable row level security;

-- Policies for hopr_alerts (allow all operations for now - can restrict by user later)
create policy "alerts readable" on hopr_alerts for select using (true);
create policy "alerts insertable" on hopr_alerts for insert with check (true);
create policy "alerts updatable" on hopr_alerts for update using (true);
create policy "alerts deletable" on hopr_alerts for delete using (true);

-- Policies for hopr_check_history (read-only for users, insert for system)
create policy "check_history readable" on hopr_check_history for select using (true);
create policy "check_history insertable" on hopr_check_history for insert with check (true);

-- Policies for hopr_notifications (read-only for users, insert for system)
create policy "notifications readable" on hopr_notifications for select using (true);
create policy "notifications insertable" on hopr_notifications for insert with check (true);

-- Sample data (optional - for testing)
-- insert into hopr_alerts (party_size, target_days, window_start, window_end, notify_email)
-- values (4, ARRAY['Friday', 'Saturday'], '16:00:00', '20:00:00', 'your-email@example.com');
