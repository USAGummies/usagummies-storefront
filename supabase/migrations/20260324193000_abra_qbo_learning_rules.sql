create table if not exists public.abra_qbo_learning_rules (
  id uuid primary key default gen_random_uuid(),
  pattern text not null,
  normalized_pattern text not null,
  account_id text not null,
  account_name text not null,
  confidence numeric not null default 0.98,
  source text not null default 'slack_correction',
  created_by text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists idx_abra_qbo_learning_rules_pattern_active
  on public.abra_qbo_learning_rules (normalized_pattern, account_id)
  where active = true;

create index if not exists idx_abra_qbo_learning_rules_active
  on public.abra_qbo_learning_rules (active, created_at desc);
