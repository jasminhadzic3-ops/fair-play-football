import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://bpvbkndywnvfvxxzzaes.supabase.co";

const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_OFAP_zA4tH5Qpbno6CiXBA_tfaCO1pm";

export const supabase = createClient(
  supabaseUrl,
  supabaseKey
);
