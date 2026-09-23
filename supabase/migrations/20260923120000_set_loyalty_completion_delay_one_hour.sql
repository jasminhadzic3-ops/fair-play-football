-- Loyalty settlement is now one hour after kickoff. This is deliberately a
-- forward-only configuration change: existing ledgers and reward records are
-- never recreated, reset, or rewritten.
do $$
declare
  v_config_count integer;
  v_current_completion_delay interval;
begin
  select count(*)
  into v_config_count
  from public.loyalty_config;

  if v_config_count <> 1 then
    raise exception 'Expected exactly one loyalty configuration row';
  end if;

  select config.completion_delay
  into v_current_completion_delay
  from public.loyalty_config as config
  where config.id = true
  for update;

  if not found then
    raise exception 'Loyalty configuration singleton is missing';
  end if;

  if v_current_completion_delay not in (interval '24 hours', interval '1 hour') then
    raise exception 'Unexpected loyalty completion delay: %', v_current_completion_delay;
  end if;

  update public.loyalty_config as config
  set completion_delay = interval '1 hour'
  where config.id = true
    and config.completion_delay is distinct from interval '1 hour';
end;
$$;
