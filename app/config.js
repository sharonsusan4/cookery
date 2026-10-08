// Where the app keeps the recipes. Copy both values from Supabase:
// Project Settings > API Keys (the "anon" / "publishable" key) and
// Project Settings > Data API (the project URL).
//
// These are safe to commit to the public repo. The anon key only lets someone
// knock on the door: the Row Level Security rules in supabase/schema.sql mean
// nothing is shown or changed unless the person has signed in with an email
// that's on the allowed_users list. Never put the "service_role" or "secret"
// key here; that one skips those rules.

const SUPABASE_URL = 'https://jezkpysgzmjtitjxjtct.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_E2OqhxZiiDdSYSicE0_RZQ_jdX82RHC';
