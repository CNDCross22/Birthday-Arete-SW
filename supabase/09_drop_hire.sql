-- ============================================================================
-- Arete Care — Drop the "date hired" / work-anniversary columns
-- The tool is birthday-only now (see FN_VERSION 2026-07-27-birthday-only), so
-- hire_date and its generated month/day helpers are dead weight.
--
-- ⚠️ IRREVERSIBLE: this permanently deletes every stored hire date.
-- ⚠️ ORDER: deploy the birthday-only Edge Function FIRST, then run this.
--    The old function selects hire_date on every lookup; dropping the column
--    before redeploying would break greetings until the new build lands.
--
-- Idempotent — safe to run once. Run in the Supabase SQL Editor.
-- ============================================================================

-- Index on the generated columns goes first (drops with them anyway; explicit is clearer).
drop index if exists public.birthdays_hire_mmdd_idx;

-- hire_month / hire_day are GENERATED from hire_date, so they must go before it.
alter table public.birthdays drop column if exists hire_month;
alter table public.birthdays drop column if exists hire_day;
alter table public.birthdays drop column if exists hire_date;

-- Note: reminder_log.kind is left in place. It still carries 'birthday' on every
-- row and the dedup key (birthday_id, reminder_year, kind) depends on it.
