-- 20260326_008_rls_policies.sql
-- chat_rooms
create policy "room members can read rooms"
on public.chat_rooms
for select
using (public.fn_chat_is_room_member(id, auth.uid()));

create policy "authenticated users can create rooms"
on public.chat_rooms
for insert
with check (auth.uid() = created_by and auth.uid() = owner_user_id);

create policy "room admins can update room meta"
on public.chat_rooms
for update
using (public.fn_chat_is_room_admin(id, auth.uid()))
with check (public.fn_chat_is_room_admin(id, auth.uid()));

-- room_members
create policy "members can read membership"
on public.room_members
for select
using (public.fn_chat_is_room_member(room_id, auth.uid()));

create policy "room admins can manage membership"
on public.room_members
for all
using (public.fn_chat_is_room_admin(room_id, auth.uid()))
with check (public.fn_chat_is_room_admin(room_id, auth.uid()));

-- messages
create policy "members can read messages"
on public.messages
for select
using (public.fn_chat_is_room_member(room_id, auth.uid()));

create policy "members can send messages"
on public.messages
for insert
with check (public.fn_chat_is_room_member(room_id, auth.uid()) and sender_id = auth.uid());

create policy "sender or room admin can update own messages"
on public.messages
for update
using (
  public.fn_chat_is_room_member(room_id, auth.uid())
  and (sender_id = auth.uid() or public.fn_chat_is_room_admin(room_id, auth.uid()))
)
with check (
  public.fn_chat_is_room_member(room_id, auth.uid())
  and (sender_id = auth.uid() or public.fn_chat_is_room_admin(room_id, auth.uid()))
);

create policy "sender or room admin can delete messages"
on public.messages
for delete
using (
  public.fn_chat_is_room_member(room_id, auth.uid())
  and (sender_id = auth.uid() or public.fn_chat_is_room_admin(room_id, auth.uid()))
);

-- message_attachments
create policy "members can read attachments"
on public.message_attachments
for select
using (public.fn_chat_is_room_member(room_id, auth.uid()));

create policy "members can create attachments"
on public.message_attachments
for insert
with check (public.fn_chat_is_room_member(room_id, auth.uid()));

create policy "sender or room admin can manage attachments"
on public.message_attachments
for update
using (
  public.fn_chat_is_room_member(room_id, auth.uid()) and (
    exists (select 1 from public.messages m where m.id = message_id and m.sender_id = auth.uid())
    or public.fn_chat_is_room_admin(room_id, auth.uid())
  )
);

create policy "members can read scheduled messages"
on public.chat_scheduled_messages
for select
using (public.fn_chat_is_room_member(room_id, auth.uid()));

create policy "members can create own scheduled messages"
on public.chat_scheduled_messages
for insert
with check (public.fn_chat_is_room_member(room_id, auth.uid()) and sender_id = auth.uid());

create policy "sender or admin can update scheduled messages"
on public.chat_scheduled_messages
for update
using (public.fn_chat_is_room_member(room_id, auth.uid()) and (sender_id = auth.uid() or public.fn_chat_is_room_admin(room_id, auth.uid())));

create policy "members can read tracker links"
on public.chat_tracker_links
for select
using (public.fn_chat_is_room_member(room_id, auth.uid()));

create policy "members can create tracker links"
on public.chat_tracker_links
for insert
with check (public.fn_chat_is_room_member(room_id, auth.uid()) and created_by = auth.uid());

alter table public.chat_action_items enable row level security;
create policy "users can read own action items"
on public.chat_action_items
for select
using (created_by = auth.uid());

create policy "users can create action items"
on public.chat_action_items
for insert
with check (created_by = auth.uid());

-- interactions
create policy "members can read reactions" on public.message_reactions for select using (public.fn_chat_is_room_member(room_id, auth.uid()));
create policy "members can react" on public.message_reactions for insert with check (public.fn_chat_is_room_member(room_id, auth.uid()) and user_id = auth.uid());
create policy "members can remove own reactions" on public.message_reactions for delete using (public.fn_chat_is_room_member(room_id, auth.uid()) and user_id = auth.uid());

create policy "members can read reads" on public.message_reads for select using (public.fn_chat_is_room_member(room_id, auth.uid()));
create policy "members can write own reads" on public.message_reads for insert with check (public.fn_chat_is_room_member(room_id, auth.uid()) and user_id = auth.uid());
create policy "members can update own reads" on public.message_reads for update using (public.fn_chat_is_room_member(room_id, auth.uid()) and user_id = auth.uid());

create policy "members can read edits" on public.message_edits for select using (public.fn_chat_is_room_member(room_id, auth.uid()));
create policy "sender or admin can insert edits" on public.message_edits for insert with check (
  public.fn_chat_is_room_member(room_id, auth.uid()) and editor_id = auth.uid() and (
    exists (select 1 from public.messages m where m.id = message_id and m.sender_id = auth.uid())
    or public.fn_chat_is_room_admin(room_id, auth.uid())
  )
);

create policy "members can read pins" on public.message_pins for select using (public.fn_chat_is_room_member(room_id, auth.uid()));
create policy "members can pin" on public.message_pins for insert with check (public.fn_chat_is_room_member(room_id, auth.uid()) and pinned_by = auth.uid());
create policy "pinner or admin can unpin" on public.message_pins for update using (public.fn_chat_is_room_member(room_id, auth.uid()) and (pinned_by = auth.uid() or public.fn_chat_is_room_admin(room_id, auth.uid())));

create policy "members can read mentions" on public.message_mentions for select using (public.fn_chat_is_room_member(room_id, auth.uid()));
create policy "members can create mentions" on public.message_mentions for insert with check (public.fn_chat_is_room_member(room_id, auth.uid()));

create policy "members can read typing" on public.typing_presence for select using (public.fn_chat_is_room_member(room_id, auth.uid()));
create policy "members can upsert own typing" on public.typing_presence for all using (public.fn_chat_is_room_member(room_id, auth.uid()) and user_id = auth.uid()) with check (public.fn_chat_is_room_member(room_id, auth.uid()) and user_id = auth.uid());

-- calling
create policy "members can read call sessions" on public.call_sessions for select using (public.fn_chat_is_room_member(room_id, auth.uid()));
create policy "members can start call sessions" on public.call_sessions for insert with check (public.fn_chat_is_room_member(room_id, auth.uid()) and started_by = auth.uid());
create policy "starter or admin can update call sessions" on public.call_sessions for update using (public.fn_chat_is_room_member(room_id, auth.uid()) and (started_by = auth.uid() or public.fn_chat_is_room_admin(room_id, auth.uid())));

create policy "members can read call participants" on public.call_participants for select using (public.fn_chat_is_room_member(room_id, auth.uid()));
create policy "members can insert self participant" on public.call_participants for insert with check (public.fn_chat_is_room_member(room_id, auth.uid()) and user_id = auth.uid());
create policy "members can update self participant" on public.call_participants for update using (public.fn_chat_is_room_member(room_id, auth.uid()) and user_id = auth.uid());

create policy "members can read call events" on public.call_events for select using (public.fn_chat_is_room_member(room_id, auth.uid()));
create policy "members can create call events" on public.call_events for insert with check (public.fn_chat_is_room_member(room_id, auth.uid()));

-- policy tables
create policy "members can read room security" on public.room_security_policies for select using (public.fn_chat_is_room_member(room_id, auth.uid()));
create policy "admins can manage room security" on public.room_security_policies for all using (public.fn_chat_is_room_admin(room_id, auth.uid())) with check (public.fn_chat_is_room_admin(room_id, auth.uid()));

create policy "members can read retention" on public.message_retention_policies for select using (public.fn_chat_is_room_member(room_id, auth.uid()));
create policy "admins can manage retention" on public.message_retention_policies for all using (public.fn_chat_is_room_admin(room_id, auth.uid())) with check (public.fn_chat_is_room_admin(room_id, auth.uid()));

-- audit + legacy map
create policy "members can read legacy map by room" on public.legacy_message_map for select using (room_id is null or public.fn_chat_is_room_member(room_id, auth.uid()));
create policy "service role can write legacy map" on public.legacy_message_map for insert with check (true);
create policy "service role can update legacy map" on public.legacy_message_map for update using (true);

create policy "authenticated can read migration audit" on public.migration_audit_log for select using (auth.uid() is not null);
create policy "service role can write migration audit" on public.migration_audit_log for insert with check (true);

create policy "members can read policy audit" on public.policy_audit_log for select using (public.fn_chat_is_room_member(room_id, auth.uid()));
create policy "admins can write policy audit" on public.policy_audit_log for insert with check (public.fn_chat_is_room_admin(room_id, auth.uid()));
