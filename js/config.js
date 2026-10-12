/* ---------------------------------------------------------------------
   Supabase connection settings
   Find both values in: Supabase Dashboard → Project Settings → API
     • Project URL        → SUPABASE_URL
     • anon / public key  → SUPABASE_ANON_KEY

   The anon key is safe to ship in a static site: every table is protected
   by Row Level Security (see supabase/schema.sql).
   NEVER put the service_role key in this file.
--------------------------------------------------------------------- */
window.APP_CONFIG = {
  SUPABASE_URL: 'https://ypifohitqzmrxmdfbyga.supabase.co/',
  SUPABASE_ANON_KEY: 'sb_publishable_YZrc7VYeBv8YpGpFN7yJNA_byXDgH8t',
};
