import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://bpvbkndywnvfvxxzzaes.supabase.co";

const supabaseKey =
  "sb_publishable_OFAP_zA4tH5Qpbno6CiXBA_tfaCO1pm";

export const supabase = createClient(
  supabaseUrl,
  supabaseKey
);