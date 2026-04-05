
-- TASK 1: fn_get_dashboard_stats
create or replace function public.fn_get_dashboard_stats(
  p_merchant_id text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rel_ids   uuid[];
  v_result    json;
begin
  if auth.uid()::text <> p_merchant_id then
    raise exception 'not_authorized';
  end if;

  select array_agg(id)
  into v_rel_ids
  from public.merchant_relationships
  where (merchant_a_id = p_merchant_id or merchant_b_id = p_merchant_id)
    and status = 'active';

  if v_rel_ids is null then
    return json_build_object(
      'total_deployed',       0,
      'active_capital',       0,
      'active_relationships', 0,
      'pending_approvals',    0
    );
  end if;

  select json_build_object(
    'total_deployed',
      coalesce((
        select sum(amount)
        from public.merchant_deals
        where relationship_id = any(v_rel_ids)
      ), 0),
    'active_capital',
      coalesce((
        select sum(amount)
        from public.merchant_deals
        where relationship_id = any(v_rel_ids)
          and status in ('active','approved')
      ), 0),
    'active_relationships',
      array_length(v_rel_ids, 1),
    'pending_approvals',
      coalesce((
        select count(*)
        from public.merchant_approvals
        where relationship_id = any(v_rel_ids)
          and status = 'pending'
      ), 0)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.fn_get_dashboard_stats(text) from public;
grant execute on function public.fn_get_dashboard_stats(text) to authenticated;

-- TASK 2: fn_finalize_settlement_decisions
create or replace function public.fn_finalize_settlement_decisions(
  p_period_id         uuid,
  p_agreement_id      uuid,
  p_agreement_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec               record;
  v_final_decision  text;
  v_reinvested      numeric;
  v_withdrawn       numeric;
  v_cap_after       numeric;
  v_snapshot        jsonb;
  v_now             timestamptz := now();
begin
  for rec in
    select *
    from public.settlement_decisions
    where settlement_period_id = p_period_id
      and agreement_id         = p_agreement_id
      and finalized_at is null
  loop
    v_final_decision := case
      when rec.decision = 'pending' then rec.default_behavior
      else rec.decision
    end;

    v_reinvested := case when v_final_decision = 'reinvest' then rec.profit_amount else 0 end;
    v_withdrawn  := case when v_final_decision = 'withdraw' then rec.profit_amount else 0 end;
    v_cap_after  := rec.effective_capital_before + v_reinvested;

    v_snapshot := p_agreement_snapshot || jsonb_build_object(
      'merchant_id',              rec.merchant_id,
      'role',                     rec.role,
      'profit_amount',            rec.profit_amount,
      'final_decision',           v_final_decision,
      'was_explicit',             rec.decision <> 'pending',
      'default_behavior',         rec.default_behavior,
      'reinvested_amount',        v_reinvested,
      'withdrawn_amount',         v_withdrawn,
      'effective_capital_before', rec.effective_capital_before,
      'effective_capital_after',  v_cap_after,
      'finalized_by',             auth.uid()::text
    );

    update public.settlement_decisions
    set decision                = v_final_decision,
        reinvested_amount       = v_reinvested,
        withdrawn_amount        = v_withdrawn,
        effective_capital_after = v_cap_after,
        finalization_snapshot   = v_snapshot,
        finalized_at            = v_now
    where id = rec.id;
  end loop;
end;
$$;

revoke all on function public.fn_finalize_settlement_decisions(uuid, uuid, jsonb) from public;
grant execute on function public.fn_finalize_settlement_decisions(uuid, uuid, jsonb) to authenticated;

-- TASK 6: notifications index for realtime filter support
create index if not exists notifications_user_id_idx
  on public.notifications (user_id);
