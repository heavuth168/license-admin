// Supabase → Project Settings → API. The anon key is safe to publish: the
// database only lets signed-in admins read or change licenses (see supabase/schema.sql).
// Never put the service_role key here.
window.VT_CONFIG = {
  supabaseUrl: "https://yhzprhtcbsgkfhgpjdjo.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InloenByaHRjYnNna2ZoZ3BqZGpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NDI1MDAsImV4cCI6MjEwNTIxODUwMH0.FXWyJJM_EvzvjBM5yJPlzCI6XMOdXu3-Gh7Vf6QxnxQ",
  appName: "VideoTranslate",
  trialDays: 7, // keep in step with public.trial_days() in schema.sql
};
