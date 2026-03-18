-- Harden Abra: add missing indexes and prevent empty email_id dedup bypass
-- 1. Unique partial index on email_id (only for non-empty values) — DB-level dedup
CREATE UNIQUE INDEX IF NOT EXISTS idx_abra_email_commands_email_id_unique
  ON abra_email_commands (email_id)
  WHERE email_id IS NOT NULL AND email_id <> '';

-- 2. Index on thread_id for fast thread context lookups
CREATE INDEX IF NOT EXISTS idx_abra_email_commands_thread_id
  ON abra_email_commands (thread_id)
  WHERE thread_id IS NOT NULL;

-- 3. Index on status for the approval queue queries
CREATE INDEX IF NOT EXISTS idx_abra_email_commands_status
  ON abra_email_commands (status);

-- 4. Index on created_at for ordering
CREATE INDEX IF NOT EXISTS idx_abra_email_commands_created_at
  ON abra_email_commands (created_at DESC);

-- 5. Triage table: index on email_id for dedup
CREATE INDEX IF NOT EXISTS idx_abra_email_triage_email_id
  ON abra_email_triage (email_id)
  WHERE email_id IS NOT NULL AND email_id <> '';

-- 6. Command evals: index on command_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_abra_command_evals_command_id
  ON abra_command_evals (command_id);
