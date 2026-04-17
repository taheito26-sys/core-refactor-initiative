CREATE POLICY "Admins can create audit logs" ON public.admin_audit_logs AS PERMISSIVE FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can view audit logs" ON public.admin_audit_logs AS PERMISSIVE FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "bl_insert" ON public.balance_ledger AS PERMISSIVE FOR INSERT WITH CHECK (is_relationship_member(relationship_id));
CREATE POLICY "bl_select" ON public.balance_ledger AS PERMISSIVE FOR SELECT USING (is_relationship_member(relationship_id));
CREATE POLICY "ct_insert" ON public.capital_transfers AS PERMISSIVE FOR INSERT WITH CHECK ((is_relationship_member(relationship_id) AND (auth.uid() = transferred_by)));
CREATE POLICY "ct_select" ON public.capital_transfers AS PERMISSIVE FOR SELECT USING (is_relationship_member(relationship_id));
CREATE POLICY "Users can delete own accounts" ON public.cash_accounts AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "Users manage own cash accounts" ON public.cash_accounts AS PERMISSIVE FOR ALL USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Participants can update" ON public.cash_custody_requests AS PERMISSIVE FOR UPDATE TO authenticated USING (((requester_user_id = auth.uid()) OR (custodian_user_id = auth.uid())));
CREATE POLICY "Participants can view their requests" ON public.cash_custody_requests AS PERMISSIVE FOR SELECT TO authenticated USING (((requester_user_id = auth.uid()) OR (custodian_user_id = auth.uid())));
CREATE POLICY "Requester can insert" ON public.cash_custody_requests AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((requester_user_id = auth.uid()));
CREATE POLICY "Users can delete own ledger entries" ON public.cash_ledger AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "Users manage own cash ledger" ON public.cash_ledger AS PERMISSIVE FOR ALL USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "attachments_member_select" ON public.chat_attachments AS PERMISSIVE FOR SELECT TO authenticated USING (fn_is_chat_member(room_id, auth.uid()));
CREATE POLICY "attachments_self_insert" ON public.chat_attachments AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((uploader_id = auth.uid()) AND fn_is_chat_member(room_id, auth.uid())));
CREATE POLICY "attachments_self_update" ON public.chat_attachments AS PERMISSIVE FOR UPDATE USING ((uploader_id = auth.uid())) WITH CHECK ((uploader_id = auth.uid()));
CREATE POLICY "audit_admin_select" ON public.chat_audit_events AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "audit_system_insert" ON public.chat_audit_events AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "call_participants_select" ON public.chat_call_participants AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM chat_calls c
  WHERE ((c.id = chat_call_participants.call_id) AND fn_is_chat_member(c.room_id, auth.uid())))));
CREATE POLICY "call_participants_upsert" ON public.chat_call_participants AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "participants_self_update" ON public.chat_call_participants AS PERMISSIVE FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "calls_member_insert" ON public.chat_calls AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((initiated_by = auth.uid()) AND fn_is_chat_member(room_id, auth.uid()) AND (EXISTS ( SELECT 1
   FROM (chat_rooms r
     JOIN chat_room_policies p ON ((p.id = r.policy_id)))
  WHERE ((r.id = chat_calls.room_id) AND (p.allow_calls = true))))));
CREATE POLICY "calls_member_select" ON public.chat_calls AS PERMISSIVE FOR SELECT TO authenticated USING ((fn_is_chat_member(room_id, auth.uid()) AND (EXISTS ( SELECT 1
   FROM (chat_rooms r
     JOIN chat_room_policies p ON ((p.id = r.policy_id)))
  WHERE ((r.id = chat_calls.room_id) AND (p.allow_calls = true))))));
CREATE POLICY "calls_member_update" ON public.chat_calls AS PERMISSIVE FOR UPDATE TO authenticated USING (fn_is_chat_member(room_id, auth.uid()));
CREATE POLICY "device_keys_select" ON public.chat_device_keys AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "device_keys_self_write" ON public.chat_device_keys AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "direct_insert" ON public.chat_direct_rooms AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_a_id = auth.uid()) OR (user_b_id = auth.uid())));
CREATE POLICY "direct_select" ON public.chat_direct_rooms AS PERMISSIVE FOR SELECT TO authenticated USING (((user_a_id = auth.uid()) OR (user_b_id = auth.uid())));
CREATE POLICY "e2ee_sessions_participant" ON public.chat_e2ee_sessions AS PERMISSIVE FOR SELECT TO authenticated USING (((sender_id = auth.uid()) OR (recipient_id = auth.uid())));
CREATE POLICY "e2ee_sessions_sender_write" ON public.chat_e2ee_sessions AS PERMISSIVE FOR ALL TO authenticated USING ((sender_id = auth.uid())) WITH CHECK ((sender_id = auth.uid()));
CREATE POLICY "reactions_member_select" ON public.chat_message_reactions AS PERMISSIVE FOR SELECT TO authenticated USING (fn_is_chat_member(room_id, auth.uid()));
CREATE POLICY "reactions_self_all" ON public.chat_message_reactions AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = auth.uid())) WITH CHECK (((user_id = auth.uid()) AND fn_is_chat_member(room_id, auth.uid())));
CREATE POLICY "receipts_member_select" ON public.chat_message_receipts AS PERMISSIVE FOR SELECT TO authenticated USING (fn_is_chat_member(room_id, auth.uid()));
CREATE POLICY "receipts_self_upsert" ON public.chat_message_receipts AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "messages_member_insert" ON public.chat_messages AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((sender_id = auth.uid()) AND fn_is_chat_member(room_id, auth.uid())));
CREATE POLICY "messages_member_select" ON public.chat_messages AS PERMISSIVE FOR SELECT TO authenticated USING ((fn_is_chat_member(room_id, auth.uid()) AND ((is_deleted = false) OR (deleted_by = auth.uid()))));
CREATE POLICY "messages_sender_update" ON public.chat_messages AS PERMISSIVE FOR UPDATE TO authenticated USING (((sender_id = auth.uid()) AND fn_is_chat_member(room_id, auth.uid()))) WITH CHECK ((sender_id = auth.uid()));
CREATE POLICY "presence_member_select" ON public.chat_presence AS PERMISSIVE FOR SELECT TO authenticated USING (fn_is_presence_visible(user_id, auth.uid()));
CREATE POLICY "presence_self_upsert" ON public.chat_presence AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "cps_insert_own" ON public.chat_privacy_settings AS PERMISSIVE FOR INSERT WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "cps_select_own" ON public.chat_privacy_settings AS PERMISSIVE FOR SELECT USING ((user_id = auth.uid()));
CREATE POLICY "cps_update_own" ON public.chat_privacy_settings AS PERMISSIVE FOR UPDATE USING ((user_id = auth.uid()));
CREATE POLICY "members_insert_self" ON public.chat_room_members AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "members_select" ON public.chat_room_members AS PERMISSIVE FOR SELECT TO authenticated USING (fn_is_chat_member(room_id, auth.uid()));
CREATE POLICY "members_update_self" ON public.chat_room_members AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "policies_authenticated_read" ON public.chat_room_policies AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "rooms_creator_insert" ON public.chat_rooms AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()));
CREATE POLICY "rooms_member_select" ON public.chat_rooms AS PERMISSIVE FOR SELECT TO authenticated USING (fn_is_chat_member(id, auth.uid()));
CREATE POLICY "rooms_member_update" ON public.chat_rooms AS PERMISSIVE FOR UPDATE TO authenticated USING (fn_is_chat_member(id, auth.uid())) WITH CHECK (fn_is_chat_member(id, auth.uid()));
CREATE POLICY "typing_member_select" ON public.chat_typing_state AS PERMISSIVE FOR SELECT TO authenticated USING (fn_is_chat_member(room_id, auth.uid()));
CREATE POLICY "typing_self_upsert" ON public.chat_typing_state AS PERMISSIVE FOR ALL TO authenticated USING ((user_id = auth.uid())) WITH CHECK (((user_id = auth.uid()) AND fn_is_chat_member(room_id, auth.uid())));
CREATE POLICY "Users can insert own conversation settings" ON public.conversation_settings AS PERMISSIVE FOR INSERT WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update own conversation settings" ON public.conversation_settings AS PERMISSIVE FOR UPDATE USING ((auth.uid() = user_id));
CREATE POLICY "Users can view own conversation settings" ON public.conversation_settings AS PERMISSIVE FOR SELECT USING ((auth.uid() = user_id));
CREATE POLICY "Admins can view all customer connections" ON public.customer_merchant_connections AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Customers can insert own connections" ON public.customer_merchant_connections AS PERMISSIVE FOR INSERT WITH CHECK ((auth.uid() = customer_user_id));
CREATE POLICY "Customers can update own connections" ON public.customer_merchant_connections AS PERMISSIVE FOR UPDATE USING ((auth.uid() = customer_user_id));
CREATE POLICY "Customers can view own connections" ON public.customer_merchant_connections AS PERMISSIVE FOR SELECT USING ((auth.uid() = customer_user_id));
CREATE POLICY "Merchants can update connections to them" ON public.customer_merchant_connections AS PERMISSIVE FOR UPDATE USING ((merchant_id = current_merchant_id()));
CREATE POLICY "Merchants can view connections to them" ON public.customer_merchant_connections AS PERMISSIVE FOR SELECT USING ((merchant_id = current_merchant_id()));
CREATE POLICY "Admins can view all customer messages" ON public.customer_messages AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Connection members can send messages" ON public.customer_messages AS PERMISSIVE FOR INSERT WITH CHECK (((auth.uid() = sender_user_id) AND is_customer_connection_member(connection_id)));
CREATE POLICY "Connection members can update messages" ON public.customer_messages AS PERMISSIVE FOR UPDATE USING (is_customer_connection_member(connection_id));
CREATE POLICY "Connection members can view messages" ON public.customer_messages AS PERMISSIVE FOR SELECT USING (is_customer_connection_member(connection_id));
CREATE POLICY "Admins can view all order events" ON public.customer_order_events AS PERMISSIVE FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated users can insert order events" ON public.customer_order_events AS PERMISSIVE FOR INSERT WITH CHECK (((auth.uid() = actor_user_id) AND (EXISTS ( SELECT 1
   FROM customer_orders o
  WHERE ((o.id = customer_order_events.order_id) AND ((o.customer_user_id = auth.uid()) OR (o.merchant_id = current_merchant_id())))))));
CREATE POLICY "Customers can view own order events" ON public.customer_order_events AS PERMISSIVE FOR SELECT USING ((EXISTS ( SELECT 1
   FROM customer_orders o
  WHERE ((o.id = customer_order_events.order_id) AND (o.customer_user_id = auth.uid())))));
CREATE POLICY "Merchants can view order events" ON public.customer_order_events AS PERMISSIVE FOR SELECT USING ((EXISTS ( SELECT 1
   FROM customer_orders o
  WHERE ((o.id = customer_order_events.order_id) AND (o.merchant_id = current_merchant_id())))));
CREATE POLICY "Admins can view all customer orders" ON public.customer_orders AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Customers can insert own orders" ON public.customer_orders AS PERMISSIVE FOR INSERT WITH CHECK ((auth.uid() = customer_user_id));
CREATE POLICY "Customers can update own orders" ON public.customer_orders AS PERMISSIVE FOR UPDATE USING ((auth.uid() = customer_user_id));
CREATE POLICY "Customers can view own orders" ON public.customer_orders AS PERMISSIVE FOR SELECT USING ((auth.uid() = customer_user_id));
CREATE POLICY "Merchants can update orders to them" ON public.customer_orders AS PERMISSIVE FOR UPDATE USING ((merchant_id = current_merchant_id()));
CREATE POLICY "Merchants can view orders to them" ON public.customer_orders AS PERMISSIVE FOR SELECT USING ((merchant_id = current_merchant_id()));
CREATE POLICY "Admins can view all customer profiles" ON public.customer_profiles AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Customers can insert own profile" ON public.customer_profiles AS PERMISSIVE FOR INSERT WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Customers can update own profile" ON public.customer_profiles AS PERMISSIVE FOR UPDATE USING ((auth.uid() = user_id));
CREATE POLICY "Customers can view own profile" ON public.customer_profiles AS PERMISSIVE FOR SELECT USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert own reference rates" ON public.daily_reference_rates AS PERMISSIVE FOR INSERT WITH CHECK ((auth.uid() = recorded_by));
CREATE POLICY "Users can update own reference rates" ON public.daily_reference_rates AS PERMISSIVE FOR UPDATE USING ((auth.uid() = recorded_by));
CREATE POLICY "Users can view own reference rates" ON public.daily_reference_rates AS PERMISSIVE FOR SELECT USING ((auth.uid() = recorded_by));
CREATE POLICY "dc_insert" ON public.deal_capital AS PERMISSIVE FOR INSERT WITH CHECK (is_relationship_member(relationship_id));
CREATE POLICY "dc_select" ON public.deal_capital AS PERMISSIVE FOR SELECT USING (is_relationship_member(relationship_id));
CREATE POLICY "Admins can view all capital ledger" ON public.deal_capital_ledger AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Relationship members can insert capital entries" ON public.deal_capital_ledger AS PERMISSIVE FOR INSERT WITH CHECK ((is_relationship_member(relationship_id) AND (auth.uid() = initiated_by)));
CREATE POLICY "Relationship members can view capital ledger" ON public.deal_capital_ledger AS PERMISSIVE FOR SELECT USING (is_relationship_member(relationship_id));
CREATE POLICY "gl_all" ON public.gas_log AS PERMISSIVE FOR ALL USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "mo_insert" ON public.market_offers AS PERMISSIVE FOR INSERT WITH CHECK (((user_id = auth.uid()) AND fn_is_chat_member(room_id, auth.uid())));
CREATE POLICY "mo_select" ON public.market_offers AS PERMISSIVE FOR SELECT USING (fn_is_chat_member(room_id, auth.uid()));
CREATE POLICY "mo_update" ON public.market_offers AS PERMISSIVE FOR UPDATE USING ((user_id = auth.uid()));
CREATE POLICY "Admins can view all approvals" ON public.merchant_approvals AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Relationship members can create approvals" ON public.merchant_approvals AS PERMISSIVE FOR INSERT WITH CHECK (((auth.uid() = submitted_by) AND is_relationship_member(relationship_id)));
CREATE POLICY "Relationship members can update approvals" ON public.merchant_approvals AS PERMISSIVE FOR UPDATE USING (is_relationship_member(relationship_id));
CREATE POLICY "Relationship members can view approvals" ON public.merchant_approvals AS PERMISSIVE FOR SELECT USING (is_relationship_member(relationship_id));
CREATE POLICY "Admins can update all deals" ON public.merchant_deals AS PERMISSIVE FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can view all deals" ON public.merchant_deals AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Deal creators can delete own pending deals" ON public.merchant_deals AS PERMISSIVE FOR DELETE USING (((auth.uid() = created_by) AND (status = 'pending'::text)));
CREATE POLICY "Relationship members can create deals" ON public.merchant_deals AS PERMISSIVE FOR INSERT WITH CHECK (((auth.uid() = created_by) AND is_relationship_member(relationship_id)));
CREATE POLICY "Relationship members can update deals" ON public.merchant_deals AS PERMISSIVE FOR UPDATE USING (is_relationship_member(relationship_id));
CREATE POLICY "Relationship members can view deals" ON public.merchant_deals AS PERMISSIVE FOR SELECT USING (is_relationship_member(relationship_id));
CREATE POLICY "Admins can view all invites" ON public.merchant_invites AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Recipients can update invites" ON public.merchant_invites AS PERMISSIVE FOR UPDATE USING ((current_merchant_id() = to_merchant_id));
CREATE POLICY "Users can send invites" ON public.merchant_invites AS PERMISSIVE FOR INSERT WITH CHECK ((current_merchant_id() = from_merchant_id));
CREATE POLICY "Users can view invites they sent or received" ON public.merchant_invites AS PERMISSIVE FOR SELECT USING (((current_merchant_id() = from_merchant_id) OR (current_merchant_id() = to_merchant_id)));
CREATE POLICY "Connected customers can view merchant liquidity" ON public.merchant_liquidity_profiles AS PERMISSIVE FOR SELECT USING ((EXISTS ( SELECT 1
   FROM customer_merchant_connections c
  WHERE ((c.merchant_id = merchant_liquidity_profiles.merchant_id) AND (c.customer_user_id = auth.uid()) AND (c.status = 'active'::text)))));
CREATE POLICY "mlp_insert" ON public.merchant_liquidity_profiles AS PERMISSIVE FOR INSERT WITH CHECK (((auth.uid() = user_id) AND (EXISTS ( SELECT 1
   FROM merchant_profiles me
  WHERE ((me.user_id = auth.uid()) AND (me.merchant_id = merchant_liquidity_profiles.merchant_id))))));
CREATE POLICY "mlp_select" ON public.merchant_liquidity_profiles AS PERMISSIVE FOR SELECT USING (((auth.uid() = user_id) OR (visibility_scope = 'network'::text) OR (EXISTS ( SELECT 1
   FROM (merchant_profiles me
     JOIN merchant_relationships rel ON ((((rel.merchant_a_id = me.merchant_id) AND (rel.merchant_b_id = merchant_liquidity_profiles.merchant_id)) OR ((rel.merchant_b_id = me.merchant_id) AND (rel.merchant_a_id = merchant_liquidity_profiles.merchant_id)))))
  WHERE ((me.user_id = auth.uid()) AND (rel.status = ANY (ARRAY['active'::text, 'pending'::text])))))));
CREATE POLICY "mlp_update" ON public.merchant_liquidity_profiles AS PERMISSIVE FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Admins can view all messages" ON public.merchant_messages AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Message recipients can mark as read" ON public.merchant_messages AS PERMISSIVE FOR UPDATE USING (is_relationship_member(relationship_id));
CREATE POLICY "Relationship members can send messages" ON public.merchant_messages AS PERMISSIVE FOR INSERT WITH CHECK (((auth.uid() = sender_id) AND is_relationship_member(relationship_id)));
CREATE POLICY "Relationship members can view messages" ON public.merchant_messages AS PERMISSIVE FOR SELECT USING (is_relationship_member(relationship_id));
CREATE POLICY "Admins can update all merchant profiles" ON public.merchant_profiles AS PERMISSIVE FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can view all merchant profiles" ON public.merchant_profiles AS PERMISSIVE FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Customers can search public merchant profiles" ON public.merchant_profiles AS PERMISSIVE FOR SELECT USING (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.role = 'customer'::text)))) AND (discoverability = 'public'::text)));
CREATE POLICY "Merchant profiles visibility by discoverability" ON public.merchant_profiles AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (discoverability = 'public'::text) OR ((discoverability = ANY (ARRAY['merchant_id_only'::text, 'hidden'::text])) AND has_relationship_with(current_merchant_id(), merchant_id))));
CREATE POLICY "Users can insert own merchant profile" ON public.merchant_profiles AS PERMISSIVE FOR INSERT WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update own merchant profile" ON public.merchant_profiles AS PERMISSIVE FOR UPDATE USING ((auth.uid() = user_id));
CREATE POLICY "Admins can view all profits" ON public.merchant_profits AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can record profits for their deals" ON public.merchant_profits AS PERMISSIVE FOR INSERT WITH CHECK (((auth.uid() = recorded_by) AND (EXISTS ( SELECT 1
   FROM merchant_deals d
  WHERE ((d.id = merchant_profits.deal_id) AND is_relationship_member(d.relationship_id))))));
CREATE POLICY "Users can view profits for their deals" ON public.merchant_profits AS PERMISSIVE FOR SELECT USING ((EXISTS ( SELECT 1
   FROM merchant_deals d
  WHERE ((d.id = merchant_profits.deal_id) AND is_relationship_member(d.relationship_id)))));
CREATE POLICY "Admins can view all relationships" ON public.merchant_relationships AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can insert relationships they are part of" ON public.merchant_relationships AS PERMISSIVE FOR INSERT WITH CHECK (((current_merchant_id() = merchant_a_id) OR (current_merchant_id() = merchant_b_id)));
CREATE POLICY "Users can update own relationships" ON public.merchant_relationships AS PERMISSIVE FOR UPDATE USING (((current_merchant_id() = merchant_a_id) OR (current_merchant_id() = merchant_b_id)));
CREATE POLICY "Users can view own relationships" ON public.merchant_relationships AS PERMISSIVE FOR SELECT USING (((current_merchant_id() = merchant_a_id) OR (current_merchant_id() = merchant_b_id)));
CREATE POLICY "Admins can view all settlements" ON public.merchant_settlements AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can create settlements for their deals" ON public.merchant_settlements AS PERMISSIVE FOR INSERT WITH CHECK (((auth.uid() = settled_by) AND (EXISTS ( SELECT 1
   FROM merchant_deals d
  WHERE ((d.id = merchant_settlements.deal_id) AND is_relationship_member(d.relationship_id))))));
CREATE POLICY "Users can view settlements for their deals" ON public.merchant_settlements AS PERMISSIVE FOR SELECT USING ((EXISTS ( SELECT 1
   FROM merchant_deals d
  WHERE ((d.id = merchant_settlements.deal_id) AND is_relationship_member(d.relationship_id)))));
CREATE POLICY "mr_delete" ON public.message_reactions AS PERMISSIVE FOR DELETE USING ((user_id = current_merchant_id()));
CREATE POLICY "mr_insert" ON public.message_reactions AS PERMISSIVE FOR INSERT WITH CHECK (((user_id = current_merchant_id()) AND (EXISTS ( SELECT 1
   FROM os_room_members
  WHERE ((os_room_members.room_id = message_reactions.room_id) AND (os_room_members.merchant_id = current_merchant_id()))))));
CREATE POLICY "mr_select" ON public.message_reactions AS PERMISSIVE FOR SELECT USING ((EXISTS ( SELECT 1
   FROM os_room_members
  WHERE ((os_room_members.room_id = message_reactions.room_id) AND (os_room_members.merchant_id = current_merchant_id())))));
CREATE POLICY "Users can insert own preferences" ON public.notification_preferences AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "Users can update own preferences" ON public.notification_preferences AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "Users can view own preferences" ON public.notification_preferences AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "Admins can view all notifications" ON public.notifications AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "System can insert notifications" ON public.notifications AS PERMISSIVE FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can update own notifications" ON public.notifications AS PERMISSIVE FOR UPDATE USING ((auth.uid() = user_id));
CREATE POLICY "Users can view own notifications" ON public.notifications AS PERMISSIVE FOR SELECT USING ((auth.uid() = user_id));
CREATE POLICY "oa_insert" ON public.order_allocations AS PERMISSIVE FOR INSERT WITH CHECK (is_relationship_member(relationship_id));
CREATE POLICY "oa_select" ON public.order_allocations AS PERMISSIVE FOR SELECT USING (is_relationship_member(relationship_id));
CREATE POLICY "oa_update" ON public.order_allocations AS PERMISSIVE FOR UPDATE USING (is_relationship_member(relationship_id));
CREATE POLICY "os_audit_insert" ON public.os_audit_events AS PERMISSIVE FOR INSERT WITH CHECK ((actor_merchant_id = current_merchant_id()));
CREATE POLICY "os_audit_select" ON public.os_audit_events AS PERMISSIVE FOR SELECT USING ((((room_id IS NOT NULL) AND is_os_room_member(room_id)) OR ((room_id IS NULL) AND has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "os_bo_insert" ON public.os_business_objects AS PERMISSIVE FOR INSERT WITH CHECK (is_os_room_member(room_id));
CREATE POLICY "os_bo_select" ON public.os_business_objects AS PERMISSIVE FOR SELECT USING (is_os_room_member(room_id));
CREATE POLICY "os_bo_update" ON public.os_business_objects AS PERMISSIVE FOR UPDATE USING (is_os_room_member(room_id));
CREATE POLICY "os_ci_select" ON public.os_channel_identities AS PERMISSIVE FOR SELECT TO authenticated USING ((merchant_id = current_merchant_id()));
CREATE POLICY "os_identities_insert" ON public.os_channel_identities AS PERMISSIVE FOR INSERT WITH CHECK ((merchant_id = current_merchant_id()));
CREATE POLICY "os_identities_update" ON public.os_channel_identities AS PERMISSIVE FOR UPDATE USING ((merchant_id = current_merchant_id()));
CREATE POLICY "os_messages_insert" ON public.os_messages AS PERMISSIVE FOR INSERT WITH CHECK ((is_os_room_member(room_id) AND (sender_merchant_id = current_merchant_id())));
CREATE POLICY "os_messages_select" ON public.os_messages AS PERMISSIVE FOR SELECT USING (is_os_room_member(room_id));
CREATE POLICY "os_messages_update" ON public.os_messages AS PERMISSIVE FOR UPDATE USING (is_os_room_member(room_id));
CREATE POLICY "os_policies_insert" ON public.os_policies AS PERMISSIVE FOR INSERT WITH CHECK ((((room_id IS NOT NULL) AND is_os_room_member(room_id)) OR ((room_id IS NULL) AND has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "os_policies_select" ON public.os_policies AS PERMISSIVE FOR SELECT USING (((room_id IS NULL) OR is_os_room_member(room_id)));
CREATE POLICY "os_room_members_insert" ON public.os_room_members AS PERMISSIVE FOR INSERT WITH CHECK ((is_os_room_member(room_id) OR (merchant_id = current_merchant_id())));
CREATE POLICY "os_room_members_select" ON public.os_room_members AS PERMISSIVE FOR SELECT USING (is_os_room_member(room_id));
CREATE POLICY "os_presence_select" ON public.os_room_presence AS PERMISSIVE FOR SELECT USING (is_os_room_member(room_id));
CREATE POLICY "os_presence_update" ON public.os_room_presence AS PERMISSIVE FOR UPDATE USING ((merchant_id = current_merchant_id()));
CREATE POLICY "os_presence_upsert" ON public.os_room_presence AS PERMISSIVE FOR INSERT WITH CHECK (((merchant_id = current_merchant_id()) AND is_os_room_member(room_id)));
CREATE POLICY "os_rooms_insert" ON public.os_rooms AS PERMISSIVE FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));
CREATE POLICY "os_rooms_select" ON public.os_rooms AS PERMISSIVE FOR SELECT USING (is_os_room_member(id));
CREATE POLICY "os_rooms_update" ON public.os_rooms AS PERMISSIVE FOR UPDATE USING (is_os_room_member(id));
CREATE POLICY "os_threads_insert" ON public.os_threads AS PERMISSIVE FOR INSERT WITH CHECK (is_os_room_member(room_id));
CREATE POLICY "os_threads_select" ON public.os_threads AS PERMISSIVE FOR SELECT USING (is_os_room_member(room_id));
CREATE POLICY "os_wf_insert" ON public.os_workflow_runs AS PERMISSIVE FOR INSERT WITH CHECK (is_os_room_member(room_id));
CREATE POLICY "os_wf_select" ON public.os_workflow_runs AS PERMISSIVE FOR SELECT USING (is_os_room_member(room_id));
CREATE POLICY "os_wf_update" ON public.os_workflow_runs AS PERMISSIVE FOR UPDATE USING (is_os_room_member(room_id));
CREATE POLICY "Admins can update disputes" ON public.otc_disputes AS PERMISSIVE FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can view all disputes" ON public.otc_disputes AS PERMISSIVE FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Dispute participants can view" ON public.otc_disputes AS PERMISSIVE FOR SELECT USING (((opened_by = auth.uid()) OR (respondent_user_id = auth.uid())));
CREATE POLICY "Participants can update disputes" ON public.otc_disputes AS PERMISSIVE FOR UPDATE USING (((opened_by = auth.uid()) OR (respondent_user_id = auth.uid())));
CREATE POLICY "Users can open disputes" ON public.otc_disputes AS PERMISSIVE FOR INSERT WITH CHECK ((opened_by = auth.uid()));
CREATE POLICY "escrow_insert" ON public.otc_escrow AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((depositor_user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM otc_trades t
  WHERE ((t.id = otc_escrow.trade_id) AND ((t.initiator_user_id = auth.uid()) OR (t.responder_user_id = auth.uid())))))));
CREATE POLICY "escrow_select" ON public.otc_escrow AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM otc_trades t
  WHERE ((t.id = otc_escrow.trade_id) AND ((t.initiator_user_id = auth.uid()) OR (t.responder_user_id = auth.uid()))))));
CREATE POLICY "escrow_update" ON public.otc_escrow AS PERMISSIVE FOR UPDATE TO authenticated USING (((depositor_user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM otc_trades t
  WHERE ((t.id = otc_escrow.trade_id) AND ((t.initiator_user_id = auth.uid()) OR (t.responder_user_id = auth.uid())))))));
CREATE POLICY "otc_listings_delete" ON public.otc_listings AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "otc_listings_insert" ON public.otc_listings AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "otc_listings_select" ON public.otc_listings AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "otc_listings_update" ON public.otc_listings AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "reviews_insert" ON public.otc_reviews AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((reviewer_user_id = auth.uid()) AND (reviewer_user_id <> reviewed_user_id) AND (EXISTS ( SELECT 1
   FROM otc_trades t
  WHERE ((t.id = otc_reviews.trade_id) AND (t.status = 'completed'::text) AND ((t.initiator_user_id = auth.uid()) OR (t.responder_user_id = auth.uid())))))));
CREATE POLICY "reviews_select" ON public.otc_reviews AS PERMISSIVE FOR SELECT TO authenticated USING (((EXISTS ( SELECT 1
   FROM otc_trades t
  WHERE ((t.id = otc_reviews.trade_id) AND ((t.initiator_user_id = auth.uid()) OR (t.responder_user_id = auth.uid()))))) OR (reviewed_user_id = auth.uid())));
CREATE POLICY "otc_trades_delete" ON public.otc_trades AS PERMISSIVE FOR DELETE TO authenticated USING (((initiator_user_id = auth.uid()) OR (responder_user_id = auth.uid())));
CREATE POLICY "otc_trades_insert" ON public.otc_trades AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((initiator_user_id = auth.uid()));
CREATE POLICY "otc_trades_select" ON public.otc_trades AS PERMISSIVE FOR SELECT TO authenticated USING (((initiator_user_id = auth.uid()) OR (responder_user_id = auth.uid())));
CREATE POLICY "otc_trades_update" ON public.otc_trades AS PERMISSIVE FOR UPDATE TO authenticated USING (((initiator_user_id = auth.uid()) OR (responder_user_id = auth.uid())));
CREATE POLICY "Anyone can read P2P snapshots" ON public.p2p_snapshots AS PERMISSIVE FOR SELECT USING (true);
CREATE POLICY "Admins can update all profiles" ON public.profiles AS PERMISSIVE FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can view all profiles" ON public.profiles AS PERMISSIVE FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can insert own profile" ON public.profiles AS PERMISSIVE FOR INSERT WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update own profile" ON public.profiles AS PERMISSIVE FOR UPDATE USING ((auth.uid() = user_id));
CREATE POLICY "Users can view own profile" ON public.profiles AS PERMISSIVE FOR SELECT USING ((auth.uid() = user_id));
CREATE POLICY "pr_insert" ON public.profit_records AS PERMISSIVE FOR INSERT WITH CHECK (is_relationship_member(relationship_id));
CREATE POLICY "pr_select" ON public.profit_records AS PERMISSIVE FOR SELECT USING (is_relationship_member(relationship_id));
CREATE POLICY "psa_insert" ON public.profit_share_agreements AS PERMISSIVE FOR INSERT WITH CHECK (is_relationship_member(relationship_id));
CREATE POLICY "psa_select" ON public.profit_share_agreements AS PERMISSIVE FOR SELECT USING (is_relationship_member(relationship_id));
CREATE POLICY "psa_update" ON public.profit_share_agreements AS PERMISSIVE FOR UPDATE USING (is_relationship_member(relationship_id));
CREATE POLICY "Users can delete own tokens" ON public.push_device_tokens AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "Users can insert own tokens" ON public.push_device_tokens AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "Users can update own tokens" ON public.push_device_tokens AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "Users can view own tokens" ON public.push_device_tokens AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));
CREATE POLICY "sd_insert" ON public.settlement_decisions AS PERMISSIVE FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM profit_share_agreements psa
  WHERE ((psa.id = settlement_decisions.agreement_id) AND is_relationship_member(psa.relationship_id)))));
CREATE POLICY "sd_select" ON public.settlement_decisions AS PERMISSIVE FOR SELECT USING ((EXISTS ( SELECT 1
   FROM profit_share_agreements psa
  WHERE ((psa.id = settlement_decisions.agreement_id) AND is_relationship_member(psa.relationship_id)))));
CREATE POLICY "sd_update" ON public.settlement_decisions AS PERMISSIVE FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM profit_share_agreements psa
  WHERE ((psa.id = settlement_decisions.agreement_id) AND is_relationship_member(psa.relationship_id)))));
CREATE POLICY "so_insert" ON public.settlement_overviews AS PERMISSIVE FOR INSERT WITH CHECK (is_relationship_member(relationship_id));
CREATE POLICY "so_select" ON public.settlement_overviews AS PERMISSIVE FOR SELECT USING (is_relationship_member(relationship_id));
CREATE POLICY "so_update" ON public.settlement_overviews AS PERMISSIVE FOR UPDATE USING (is_relationship_member(relationship_id));
CREATE POLICY "Admins can view all settlement periods" ON public.settlement_periods AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Relationship members can insert settlement periods" ON public.settlement_periods AS PERMISSIVE FOR INSERT WITH CHECK (is_relationship_member(relationship_id));
CREATE POLICY "Relationship members can update settlement periods" ON public.settlement_periods AS PERMISSIVE FOR UPDATE USING (is_relationship_member(relationship_id));
CREATE POLICY "Relationship members can view settlement periods" ON public.settlement_periods AS PERMISSIVE FOR SELECT USING (is_relationship_member(relationship_id));
CREATE POLICY "Admins can update all tracker snapshots" ON public.tracker_snapshots AS PERMISSIVE FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can view all tracker snapshots" ON public.tracker_snapshots AS PERMISSIVE FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can insert own tracker state" ON public.tracker_snapshots AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update own tracker state" ON public.tracker_snapshots AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY "Users can view own tracker state" ON public.tracker_snapshots AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = user_id));
CREATE POLICY "ts_all" ON public.tracker_states AS PERMISSIVE FOR ALL USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Admins can manage roles" ON public.user_roles AS PERMISSIVE FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can view all roles" ON public.user_roles AS PERMISSIVE FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can view own roles" ON public.user_roles AS PERMISSIVE FOR SELECT USING ((auth.uid() = user_id));
