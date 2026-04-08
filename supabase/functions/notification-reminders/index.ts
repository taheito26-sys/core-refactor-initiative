/**
 * notification-reminders — Cron-triggered function that:
 * 1. Checks for pending deals & overdue settlements and creates reminder notifications
 * 2. Processes due reminders from the notification_reminders table
 *
 * Should be called every 15 minutes via pg_cron.
 */

import { corsHeaders } from '@supabase/supabase-js/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let remindersCreated = 0;
    let remindersSent = 0;

    // ─── 1. Auto-generate reminders for pending deals (>24h old) ────────────
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: pendingDeals } = await supabase
      .from('merchant_deals')
      .select('id, title, amount, currency, relationship_id, created_by, created_at')
      .eq('status', 'pending')
      .lt('created_at', twentyFourHoursAgo)
      .limit(50);

    if (pendingDeals?.length) {
      for (const deal of pendingDeals) {
        // Find the partner who needs to act (not the creator)
        const { data: rel } = await supabase
          .from('merchant_relationships')
          .select('merchant_a_id, merchant_b_id')
          .eq('id', deal.relationship_id)
          .single();

        if (!rel) continue;

        // Determine which merchant is the partner (not the creator)
        const { data: creatorProfile } = await supabase
          .from('merchant_profiles')
          .select('merchant_id')
          .eq('user_id', deal.created_by)
          .single();

        const partnerMerchantId = creatorProfile?.merchant_id === rel.merchant_a_id
          ? rel.merchant_b_id
          : rel.merchant_a_id;

        const { data: partnerProfile } = await supabase
          .from('merchant_profiles')
          .select('user_id')
          .eq('merchant_id', partnerMerchantId)
          .single();

        if (!partnerProfile?.user_id) continue;

        // Check if we already sent a reminder for this deal recently (last 24h)
        const { data: existing } = await supabase
          .from('notification_reminders')
          .select('id')
          .eq('user_id', partnerProfile.user_id)
          .eq('entity_type', 'deal')
          .eq('entity_id', deal.id)
          .gte('created_at', twentyFourHoursAgo)
          .limit(1);

        if (existing?.length) continue;

        // Create reminder notification
        const { error: notifErr } = await supabase
          .from('notifications')
          .insert({
            user_id: partnerProfile.user_id,
            category: 'deal',
            title: '⏰ Pending deal needs your action',
            body: `"${deal.title}" (${deal.amount} ${deal.currency}) has been waiting for over 24 hours`,
            entity_type: 'deal',
            entity_id: deal.id,
            target_path: '/trading/orders',
            target_tab: 'incoming',
            target_focus: 'focusDealId',
            target_entity_type: 'deal',
            target_entity_id: deal.id,
          });

        if (!notifErr) {
          // Track the reminder
          await supabase.from('notification_reminders').insert({
            user_id: partnerProfile.user_id,
            entity_type: 'deal',
            entity_id: deal.id,
            remind_at: new Date().toISOString(),
            sent_at: new Date().toISOString(),
          });
          remindersCreated++;
        }
      }
    }

    // ─── 2. Auto-generate reminders for overdue settlement periods ──────────
    const { data: overduePeriods } = await supabase
      .from('settlement_periods')
      .select('id, deal_id, period_end, status')
      .eq('status', 'due')
      .lt('period_end', new Date().toISOString())
      .limit(50);

    if (overduePeriods?.length) {
      for (const period of overduePeriods) {
        // Get the deal to find involved parties
        const { data: deal } = await supabase
          .from('merchant_deals')
          .select('relationship_id, created_by, title')
          .eq('id', period.deal_id)
          .single();

        if (!deal) continue;

        const { data: rel } = await supabase
          .from('merchant_relationships')
          .select('merchant_a_id, merchant_b_id')
          .eq('id', deal.relationship_id)
          .single();

        if (!rel) continue;

        // Notify both merchants about overdue settlement
        for (const merchantId of [rel.merchant_a_id, rel.merchant_b_id]) {
          const { data: profile } = await supabase
            .from('merchant_profiles')
            .select('user_id')
            .eq('merchant_id', merchantId)
            .single();

          if (!profile?.user_id) continue;

          // Dedup: check if reminder already sent
          const { data: existing } = await supabase
            .from('notification_reminders')
            .select('id')
            .eq('user_id', profile.user_id)
            .eq('entity_type', 'settlement_period')
            .eq('entity_id', period.id)
            .gte('created_at', twentyFourHoursAgo)
            .limit(1);

          if (existing?.length) continue;

          const { error: notifErr } = await supabase
            .from('notifications')
            .insert({
              user_id: profile.user_id,
              category: 'settlement',
              title: '⏰ Overdue settlement requires attention',
              body: `Settlement for "${deal.title}" is overdue and needs resolution`,
              entity_type: 'settlement',
              entity_id: period.id,
              target_path: '/trading/orders',
              target_tab: 'settlements',
              target_focus: 'focusSettlementId',
              target_entity_type: 'settlement',
              target_entity_id: period.id,
            });

          if (!notifErr) {
            await supabase.from('notification_reminders').insert({
              user_id: profile.user_id,
              entity_type: 'settlement_period',
              entity_id: period.id,
              remind_at: new Date().toISOString(),
              sent_at: new Date().toISOString(),
            });
            remindersCreated++;
          }
        }
      }
    }

    // ─── 3. Process scheduled custom reminders ──────────────────────────────
    const { data: dueReminders } = await supabase
      .from('notification_reminders')
      .select('id, user_id, entity_type, entity_id, source_notification_id')
      .is('sent_at', null)
      .is('cancelled_at', null)
      .lte('remind_at', new Date().toISOString())
      .limit(100);

    if (dueReminders?.length) {
      for (const reminder of dueReminders) {
        let title = '⏰ Reminder';
        let body = 'You have a pending item that needs attention';

        // Get source notification for context
        if (reminder.source_notification_id) {
          const { data: source } = await supabase
            .from('notifications')
            .select('title, body, category, target_path, target_tab, target_focus, target_entity_type, target_entity_id')
            .eq('id', reminder.source_notification_id)
            .single();

          if (source) {
            title = `⏰ Reminder: ${source.title}`;
            body = source.body ?? body;

            await supabase.from('notifications').insert({
              user_id: reminder.user_id,
              category: source.category ?? 'system',
              title,
              body,
              entity_type: reminder.entity_type,
              entity_id: reminder.entity_id,
              target_path: source.target_path,
              target_tab: source.target_tab,
              target_focus: source.target_focus,
              target_entity_type: source.target_entity_type,
              target_entity_id: source.target_entity_id,
            });
          }
        } else {
          await supabase.from('notifications').insert({
            user_id: reminder.user_id,
            category: 'system',
            title,
            body,
            entity_type: reminder.entity_type,
            entity_id: reminder.entity_id,
          });
        }

        // Mark as sent
        await supabase
          .from('notification_reminders')
          .update({ sent_at: new Date().toISOString() })
          .eq('id', reminder.id);

        remindersSent++;
      }
    }

    // ─── 4. Trigger push notifications for all newly created reminders ──────
    // (The push-send function handles this if FCM is configured)
    const pushUrl = `${supabaseUrl}/functions/v1/push-send`;
    const recentNotifs = await supabase
      .from('notifications')
      .select('id, user_id, title, body, category, target_path')
      .gte('created_at', new Date(Date.now() - 2 * 60 * 1000).toISOString())
      .is('read_at', null)
      .limit(20);

    let pushSent = 0;
    if (recentNotifs.data?.length) {
      for (const n of recentNotifs.data) {
        try {
          await fetch(pushUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              user_id: n.user_id,
              title: n.title,
              body: n.body,
              data: { notification_id: n.id, path: n.target_path ?? '/notifications' },
            }),
          });
          pushSent++;
        } catch (e) {
          console.error('[notification-reminders] Push error:', e);
        }
      }
    }

    return new Response(JSON.stringify({
      reminders_created: remindersCreated,
      reminders_sent: remindersSent,
      push_attempted: pushSent,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[notification-reminders] Error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
