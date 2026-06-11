-- ═══════════════════════════════════════════════════════════════════════════════
-- FanNav — Supabase Schema
-- Run this once in your Supabase project: Dashboard → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. WAIT REPORTS  (crowd-sourced venue wait times — already used in Day 3)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists wait_reports (
  id          bigserial       primary key,
  match_id    int             not null,
  venue_id    text            not null,
  zone        text            not null,
  mins        int             not null check (mins >= 0 and mins <= 120),
  fingerprint text,
  created_at  timestamptz     not null default now()
);

create index if not exists wait_reports_match_created
  on wait_reports (match_id, created_at desc);

alter table wait_reports enable row level security;

create policy "public read wait_reports"
  on wait_reports for select using (true);

create policy "public insert wait_reports"
  on wait_reports for insert with check (
    mins >= 0 and mins <= 120
    and char_length(zone) <= 80
  );

-- Enable realtime for live crowd updates
alter publication supabase_realtime add table wait_reports;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PURCHASES  (one row per successful PayPal payment)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists purchases (
  id                    bigserial     primary key,

  -- PayPal identifiers
  order_id              text          not null unique,  -- PayPal order ID
  capture_id            text          unique,           -- PayPal capture ID (set after capture)
  refund_id             text,                           -- PayPal refund ID if refunded

  -- Plan
  plan_id               text          not null check (plan_id in ('match', 'tournament')),
  amount                numeric(8,2)  not null,
  currency              char(3)       not null default 'USD',

  -- Status lifecycle:
  --   completed         → verified by verify-order endpoint
  --   webhook_confirmed → additionally confirmed by PayPal webhook
  --   refunded          → payment refunded
  --   reversed          → chargeback / payment reversed
  status                text          not null default 'completed'
                          check (status in ('completed','webhook_confirmed','refunded','reversed')),

  -- Payer info (from PayPal order object)
  payer_email           text,
  payer_name            text,

  -- Browser fingerprint for cross-device Pro lookup without login
  fingerprint           text,

  -- Webhook confirmation timestamps
  webhook_confirmed     boolean       not null default false,
  webhook_confirmed_at  timestamptz,
  refunded_at           timestamptz,
  reversed_at           timestamptz,

  created_at            timestamptz   not null default now()
);

create index if not exists purchases_capture_id    on purchases (capture_id);
create index if not exists purchases_payer_email   on purchases (payer_email);
create index if not exists purchases_fingerprint   on purchases (fingerprint);
create index if not exists purchases_status        on purchases (status);
create index if not exists purchases_created_at    on purchases (created_at desc);

-- RLS: only service_role can read/write purchases (no public access)
alter table purchases enable row level security;

create policy "service role only — purchases"
  on purchases for all
  using     (auth.role() = 'service_role')
  with check(auth.role() = 'service_role');


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. WEBHOOK EVENTS  (audit log of every PayPal webhook received)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists webhook_events (
  id          bigserial     primary key,
  event_id    text          not null unique,   -- PayPal event ID (idempotency)
  event_type  text          not null,
  capture_id  text,
  order_id    text,
  refund_id   text,
  amount      numeric(8,2),
  raw         jsonb,                           -- full PayPal resource object
  created_at  timestamptz   not null default now()
);

create index if not exists webhook_events_event_type  on webhook_events (event_type);
create index if not exists webhook_events_capture_id  on webhook_events (capture_id);
create index if not exists webhook_events_created_at  on webhook_events (created_at desc);

-- RLS: only service_role
alter table webhook_events enable row level security;

create policy "service role only — webhook_events"
  on webhook_events for all
  using     (auth.role() = 'service_role')
  with check(auth.role() = 'service_role');


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. HELPER FUNCTION: check if a fingerprint has an active Pro purchase
--    Used by the frontend's /api/check-pro endpoint (optional)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.fingerprint_has_pro(fp text)
returns boolean
language sql security definer
as $$
  select exists (
    select 1 from purchases
    where fingerprint = fp
      and status in ('completed', 'webhook_confirmed')
  );
$$;

-- Grant execute to anon so the frontend can call it via RPC
grant execute on function public.fingerprint_has_pro(text) to anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. VERIFY PURCHASE VIEW  (safe read-only view for the check-pro endpoint)
--    Exposes only what the frontend needs — no PII
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.purchase_status as
  select
    fingerprint,
    plan_id,
    status,
    created_at
  from purchases
  where status in ('completed', 'webhook_confirmed');

-- Allow anon to read this view (no PII exposed)
grant select on public.purchase_status to anon;
