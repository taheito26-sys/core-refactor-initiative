// ─── Settlement Decisions Cron ───────────────────────────────────────
// Generates monthly profit handling decision requests for operator priority
// agreements when settlement periods become due.
// Also finalizes overdue decisions by applying default behavior.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const results = { decisionsCreated: 0, decisionsFinalized: 0, notificationsSent: 0, errors: [] as string[] };

  try {
    // 1. Find due/overdue settlement periods for operator_priority agreements
    //    that don't have settlement decisions yet
    const { data: duePeriods, error: periodsErr } = await supabase
      .from('settlement_periods')
      .select('id, deal_id, relationship_id, period_key, period_end, due_at, status, partner_amount, merchant_amount, net_profit')
      .in('status', ['due', 'overdue'])
      .order('period_end', { ascending: true });

    if (periodsErr) {
      results.errors.push(`Periods query: ${periodsErr.message}`);
      return new Response(JSON.stringify(results), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    for (const period of (duePeriods || [])) {
      // Check if this period's deal has an operator_priority agreement
      const { data: agreements } = await supabase
        .from('profit_share_agreements')
        .select('*')
        .eq('relationship_id', period.relationship_id)
        .eq('agreement_type', 'operator_priority')
        .eq('status', 'approved');

      if (!agreements || agreements.length === 0) continue;

      const agreement = agreements[0];

      // Check if decisions already exist for this period
      const { data: existingDecisions } = await supabase
        .from('settlement_decisions')
        .select('id, merchant_id, decision, finalized_at')
        .eq('settlement_period_id', period.id);

      if (!existingDecisions || existingDecisions.length === 0) {
        // Create decision requests for both merchants
        const operatorMerchantId = agreement.operator_merchant_id;
        const { data: rel } = await supabase
          .from('merchant_relationships')
          .select('merchant_a_id, merchant_b_id')
          .eq('id', period.relationship_id)
          .single();

        if (!rel) continue;

        const lenderMerchantId = rel.merchant_a_id === operatorMerchantId
          ? rel.merchant_b_id
          : rel.merchant_a_id;

        // Calculate effective capital (base + reinvested from prior decisions)
        const opBase = Number(agreement.operator_contribution) || 0;
        const lnBase = Number(agreement.lender_contribution) || 0;

        // Look for most recent finalized decision to get effective capital
        const { data: priorOp } = await supabase
          .from('settlement_decisions')
          .select('effective_capital_after')
          .eq('agreement_id', agreement.id)
          .eq('merchant_id', operatorMerchantId)
          .not('finalized_at', 'is', null)
          .order('finalized_at', { ascending: false })
          .limit(1);

        const { data: priorLn } = await supabase
          .from('settlement_decisions')
          .select('effective_capital_after')
          .eq('agreement_id', agreement.id)
          .eq('merchant_id', lenderMerchantId)
          .not('finalized_at', 'is', null)
          .order('finalized_at', { ascending: false })
          .limit(1);

        const opEffective = priorOp?.[0]?.effective_capital_after ?? opBase;
        const lnEffective = priorLn?.[0]?.effective_capital_after ?? lnBase;

        // Calculate profit distribution
        const operatorRatio = Number(agreement.operator_ratio) || 0;
        const grossProfit = Number(period.net_profit) || 0;
        const operatorFee = grossProfit * operatorRatio / 100;
        const remainingProfit = grossProfit - operatorFee;
        const totalCapital = opEffective + lnEffective;
        const opShare = totalCapital > 0
          ? operatorFee + (remainingProfit * opEffective / totalCapital)
          : operatorFee + remainingProfit;
        const lnShare = totalCapital > 0
          ? remainingProfit * lnEffective / totalCapital
          : 0;

        const dueAt = period.due_at || new Date(new Date(period.period_end).getTime() + 86400000 * 7).toISOString();

        const decisions = [
          {
            settlement_period_id: period.id,
            agreement_id: agreement.id,
            merchant_id: operatorMerchantId,
            role: 'operator',
            profit_amount: Math.round(opShare * 100) / 100,
            decision: 'pending',
            default_behavior: agreement.operator_default_profit_handling || 'reinvest',
            decision_due_at: dueAt,
            effective_capital_before: opEffective,
            effective_capital_after: opEffective,
          },
          {
            settlement_period_id: period.id,
            agreement_id: agreement.id,
            merchant_id: lenderMerchantId,
            role: 'lender',
            profit_amount: Math.round(lnShare * 100) / 100,
            decision: 'pending',
            default_behavior: agreement.counterparty_default_profit_handling || 'withdraw',
            decision_due_at: dueAt,
            effective_capital_before: lnEffective,
            effective_capital_after: lnEffective,
          },
        ];

        const { error: insertErr } = await supabase
          .from('settlement_decisions')
          .insert(decisions);

        if (insertErr) {
          results.errors.push(`Insert decisions for period ${period.id}: ${insertErr.message}`);
        } else {
          results.decisionsCreated += 2;

          // Send notifications to both merchants
          for (const d of decisions) {
            const { data: mp } = await supabase
              .from('merchant_profiles')
              .select('user_id')
              .eq('merchant_id', d.merchant_id)
              .single();

            if (mp?.user_id) {
              await supabase.from('notifications').insert({
                user_id: mp.user_id,
                category: 'settlement',
                title: `📊 Monthly profit decision required`,
                body: `Your share: ${d.profit_amount.toFixed(2)} USDT for period ${period.period_key}. Choose to reinvest or withdraw before the cutoff.`,
                entity_type: 'settlement_decision',
                entity_id: period.id,
              });
              results.notificationsSent++;
            }
          }
        }
      } else {
        // Check if any pending decisions are past due → finalize with defaults
        const now = new Date();
        for (const d of existingDecisions) {
          if (d.decision === 'pending' && !d.finalized_at) {
            // Get the full decision record
            const { data: fullDecision } = await supabase
              .from('settlement_decisions')
              .select('*')
              .eq('id', d.id)
              .single();

            if (!fullDecision) continue;

            const dueAt = fullDecision.decision_due_at ? new Date(fullDecision.decision_due_at) : null;
            if (dueAt && now > dueAt) {
              // Finalize with default
              const finalDecision = fullDecision.default_behavior || 'withdraw';
              const reinvested = finalDecision === 'reinvest' ? Number(fullDecision.profit_amount) : 0;
              const withdrawn = finalDecision === 'withdraw' ? Number(fullDecision.profit_amount) : 0;
              const capAfter = Number(fullDecision.effective_capital_before) + reinvested;

              const { error: updateErr } = await supabase
                .from('settlement_decisions')
                .update({
                  decision: finalDecision,
                  reinvested_amount: reinvested,
                  withdrawn_amount: withdrawn,
                  effective_capital_after: capAfter,
                  finalized_at: now.toISOString(),
                  finalization_snapshot: {
                    auto_finalized: true,
                    default_behavior: fullDecision.default_behavior,
                    finalized_at: now.toISOString(),
                  },
                })
                .eq('id', d.id);

              if (!updateErr) {
                results.decisionsFinalized++;
              }
            }
          }
        }
      }
    }
  } catch (err: any) {
    results.errors.push(err.message || 'Unknown error');
  }

  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
