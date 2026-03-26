-- 20260326_007_chat_functions_and_views.sql
create or replace function public.fn_chat_is_room_member(_room_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members rm
    where rm.room_id = _room_id
      and rm.user_id = _user_id
      and rm.left_at is null
  );
$$;

create or replace function public.fn_chat_is_room_admin(_room_id uuid, _user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members rm
    where rm.room_id = _room_id
      and rm.user_id = _user_id
      and rm.left_at is null
      and rm.role in ('owner','admin')
  );
$$;

create or replace function public.fn_chat_send_message(
  _room_id uuid,
  _body text,
  _body_json jsonb default '{}'::jsonb,
  _message_type text default 'text',
  _client_nonce text default null,
  _reply_to_message_id uuid default null
)
returns public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
  _msg public.messages;
begin
  if not public.fn_chat_is_room_member(_room_id, auth.uid()) then
    raise exception 'Not authorized for room';
  end if;

  if _client_nonce is not null then
    select * into _msg from public.messages
    where room_id = _room_id and client_nonce = _client_nonce
    limit 1;
    if found then
      return _msg;
    end if;
  end if;

  insert into public.messages (
    room_id, sender_id, body, body_json, message_type, client_nonce, reply_to_message_id, status, sent_at, delivered_at
  ) values (
    _room_id, auth.uid(), coalesce(_body,''), coalesce(_body_json, '{}'::jsonb), coalesce(_message_type,'text'), _client_nonce, _reply_to_message_id, 'sent', now(), now()
  ) returning * into _msg;

  update public.chat_rooms set updated_at = now() where id = _room_id;

  return _msg;
end;
$$;

create or replace function public.fn_chat_mark_read(
  _room_id uuid,
  _message_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fn_chat_is_room_member(_room_id, auth.uid()) then
    raise exception 'Not authorized for room';
  end if;

  insert into public.message_reads (room_id, message_id, user_id, read_at)
  values (_room_id, _message_id, auth.uid(), now())
  on conflict (message_id, user_id) do update set read_at = excluded.read_at;

  update public.room_members
  set last_read_message_id = _message_id
  where room_id = _room_id and user_id = auth.uid();

  update public.messages
  set status = case when sender_id = auth.uid() then status else 'read' end
  where id = _message_id and room_id = _room_id;

  return true;
end;
$$;

create or replace function public.fn_chat_pin_message(_room_id uuid, _message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fn_chat_is_room_member(_room_id, auth.uid()) then
    raise exception 'Not authorized for room';
  end if;

  insert into public.message_pins(room_id, message_id, pinned_by, pinned_at, unpinned_at, unpinned_by)
  values (_room_id, _message_id, auth.uid(), now(), null, null)
  on conflict (room_id, message_id)
  do update set pinned_by = excluded.pinned_by, pinned_at = now(), unpinned_at = null, unpinned_by = null;

  return true;
end;
$$;

create or replace function public.fn_chat_unpin_message(_room_id uuid, _message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fn_chat_is_room_member(_room_id, auth.uid()) then
    raise exception 'Not authorized for room';
  end if;

  update public.message_pins
  set unpinned_at = now(), unpinned_by = auth.uid()
  where room_id = _room_id and message_id = _message_id and unpinned_at is null;

  return true;
end;
$$;

create or replace function public.fn_chat_add_reaction(_room_id uuid, _message_id uuid, _reaction text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fn_chat_is_room_member(_room_id, auth.uid()) then
    raise exception 'Not authorized for room';
  end if;
  insert into public.message_reactions(room_id, message_id, user_id, reaction)
  values (_room_id, _message_id, auth.uid(), _reaction)
  on conflict (message_id, user_id, reaction) do nothing;
  return true;
end;
$$;

create or replace function public.fn_chat_remove_reaction(_room_id uuid, _message_id uuid, _reaction text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fn_chat_is_room_member(_room_id, auth.uid()) then
    raise exception 'Not authorized for room';
  end if;
  delete from public.message_reactions
  where room_id = _room_id and message_id = _message_id and user_id = auth.uid() and reaction = _reaction;
  return true;
end;
$$;

create or replace function public.fn_chat_start_call(_room_id uuid)
returns public.call_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  _call public.call_sessions;
begin
  if not public.fn_chat_is_room_member(_room_id, auth.uid()) then
    raise exception 'Not authorized for room';
  end if;

  insert into public.call_sessions(room_id, started_by, status, started_at)
  values (_room_id, auth.uid(), 'ringing', now())
  returning * into _call;

  insert into public.call_participants(call_session_id, room_id, user_id, status)
  select _call.id, _room_id, rm.user_id, case when rm.user_id = auth.uid() then 'joined' else 'ringing' end
  from public.room_members rm
  where rm.room_id = _room_id and rm.left_at is null
  on conflict (call_session_id, user_id) do nothing;

  insert into public.call_events(call_session_id, room_id, actor_id, event_type, payload)
  values (_call.id, _room_id, auth.uid(), 'call_started', '{}'::jsonb);

  return _call;
end;
$$;

create or replace function public.fn_chat_join_call(_call_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  _room_id uuid;
begin
  select room_id into _room_id from public.call_sessions where id = _call_session_id and status in ('ringing','active');
  if _room_id is null then
    raise exception 'Call not joinable';
  end if;

  if not public.fn_chat_is_room_member(_room_id, auth.uid()) then
    raise exception 'Not authorized for call';
  end if;

  insert into public.call_participants(call_session_id, room_id, user_id, status, joined_at)
  values (_call_session_id, _room_id, auth.uid(), 'joined', now())
  on conflict (call_session_id, user_id)
  do update set status='joined', joined_at = coalesce(public.call_participants.joined_at, now()), left_at = null;

  update public.call_sessions
  set status = case when status = 'ringing' then 'active' else status end,
      answered_at = coalesce(answered_at, now())
  where id = _call_session_id;

  insert into public.call_events(call_session_id, room_id, actor_id, event_type, payload)
  values (_call_session_id, _room_id, auth.uid(), 'participant_joined', '{}'::jsonb);

  return true;
end;
$$;

create or replace function public.fn_chat_leave_call(_call_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  _room_id uuid;
  _active_count int;
begin
  select room_id into _room_id from public.call_sessions where id = _call_session_id;
  if _room_id is null then
    return false;
  end if;

  if not public.fn_chat_is_room_member(_room_id, auth.uid()) then
    raise exception 'Not authorized for call';
  end if;

  update public.call_participants
  set status='left', left_at=now()
  where call_session_id = _call_session_id and user_id = auth.uid();

  insert into public.call_events(call_session_id, room_id, actor_id, event_type, payload)
  values (_call_session_id, _room_id, auth.uid(), 'participant_left', '{}'::jsonb);

  select count(*)::int into _active_count
  from public.call_participants
  where call_session_id = _call_session_id and status = 'joined';

  if _active_count = 0 then
    update public.call_sessions
    set status='ended', ended_at=now(), ended_by=auth.uid(), ended_reason='last_participant_left'
    where id = _call_session_id and status <> 'ended';
  end if;

  return true;
end;
$$;

create or replace function public.fn_chat_end_call(_call_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  _room_id uuid;
begin
  select room_id into _room_id from public.call_sessions where id = _call_session_id;
  if _room_id is null then
    return false;
  end if;

  if not public.fn_chat_is_room_admin(_room_id, auth.uid()) and not exists (
    select 1 from public.call_sessions where id = _call_session_id and started_by = auth.uid()
  ) then
    raise exception 'Not authorized to end call';
  end if;

  update public.call_sessions
  set status='ended', ended_at=now(), ended_by=auth.uid(), ended_reason=coalesce(ended_reason,'ended_by_user')
  where id = _call_session_id;

  update public.call_participants
  set status = case when status='declined' then status else 'left' end,
      left_at = coalesce(left_at, now())
  where call_session_id = _call_session_id;

  insert into public.call_events(call_session_id, room_id, actor_id, event_type, payload)
  values (_call_session_id, _room_id, auth.uid(), 'call_ended', '{}'::jsonb);

  return true;
end;
$$;

create or replace function public.fn_chat_apply_room_policy(
  _room_id uuid,
  _security jsonb default '{}'::jsonb,
  _retention jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  _old_security jsonb;
  _old_retention jsonb;
begin
  if not public.fn_chat_is_room_admin(_room_id, auth.uid()) then
    raise exception 'Not authorized to change room policy';
  end if;

  select to_jsonb(rsp.*) into _old_security from public.room_security_policies rsp where rsp.room_id = _room_id;
  select to_jsonb(mrp.*) into _old_retention from public.message_retention_policies mrp where mrp.room_id = _room_id;

  insert into public.room_security_policies (
    room_id, disable_forward, disable_copy, disable_export, disable_attachment_download,
    restricted_badge, watermark_label, watermark_enabled, updated_by, updated_at
  ) values (
    _room_id,
    coalesce((_security->>'disable_forward')::boolean, false),
    coalesce((_security->>'disable_copy')::boolean, false),
    coalesce((_security->>'disable_export')::boolean, false),
    coalesce((_security->>'disable_attachment_download')::boolean, false),
    coalesce((_security->>'restricted_badge')::boolean, false),
    _security->>'watermark_label',
    coalesce((_security->>'watermark_enabled')::boolean, false),
    auth.uid(),
    now()
  )
  on conflict (room_id) do update set
    disable_forward = excluded.disable_forward,
    disable_copy = excluded.disable_copy,
    disable_export = excluded.disable_export,
    disable_attachment_download = excluded.disable_attachment_download,
    restricted_badge = excluded.restricted_badge,
    watermark_label = excluded.watermark_label,
    watermark_enabled = excluded.watermark_enabled,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.message_retention_policies (
    room_id, retention_mode, retention_ttl_seconds, default_vanish_ttl_seconds, updated_by, updated_at
  ) values (
    _room_id,
    coalesce(_retention->>'retention_mode','keep'),
    nullif(_retention->>'retention_ttl_seconds','')::int,
    nullif(_retention->>'default_vanish_ttl_seconds','')::int,
    auth.uid(),
    now()
  )
  on conflict (room_id) do update set
    retention_mode = excluded.retention_mode,
    retention_ttl_seconds = excluded.retention_ttl_seconds,
    default_vanish_ttl_seconds = excluded.default_vanish_ttl_seconds,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.policy_audit_log(room_id, changed_by, change_type, old_value, new_value)
  values (
    _room_id,
    auth.uid(),
    'apply_room_policy',
    jsonb_build_object('security', _old_security, 'retention', _old_retention),
    jsonb_build_object('security', _security, 'retention', _retention)
  );

  return true;
end;
$$;

create or replace function public.fn_chat_migrate_legacy_messages(
  _dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _rel record;
  _msg record;
  _room_id uuid;
  _inserted int := 0;
  _skipped int := 0;
  _failed int := 0;
  _orphaned int := 0;
  _migrated int := 0;
  _new_message_id uuid;
  _last_error text;
begin
  for _rel in
    select mr.id, mr.merchant_a_id, mr.merchant_b_id
    from public.merchant_relationships mr
  loop
    select cr.id into _room_id from public.chat_rooms cr where cr.relationship_id = _rel.id limit 1;

    if _room_id is null then
      if _dry_run then
        _room_id := gen_random_uuid();
      else
        insert into public.chat_rooms(kind, title, relationship_id, owner_user_id, created_by, metadata)
        select
          'direct',
          coalesce(mpa.display_name, _rel.merchant_a_id) || ' / ' || coalesce(mpb.display_name, _rel.merchant_b_id),
          _rel.id,
          coalesce(mpa.user_id, mpb.user_id),
          coalesce(mpa.user_id, mpb.user_id),
          jsonb_build_object('legacy_source', 'merchant_relationships')
        from public.merchant_profiles mpa
        left join public.merchant_profiles mpb on mpb.merchant_id = _rel.merchant_b_id
        where mpa.merchant_id = _rel.merchant_a_id
        returning id into _room_id;

        insert into public.room_members(room_id, user_id, role)
        select _room_id, m.user_id,
          case when m.merchant_id = _rel.merchant_a_id then 'owner' else 'member' end
        from public.merchant_profiles m
        where m.merchant_id in (_rel.merchant_a_id, _rel.merchant_b_id)
        on conflict (room_id, user_id) do nothing;
      end if;
    end if;

    for _msg in
      select mm.* from public.merchant_messages mm where mm.relationship_id = _rel.id order by mm.created_at asc
    loop
      if exists (
        select 1 from public.legacy_message_map l
        where l.legacy_source = 'merchant_messages' and l.legacy_message_id = _msg.id::text
      ) then
        _skipped := _skipped + 1;
        continue;
      end if;

      begin
        if _dry_run then
          _migrated := _migrated + 1;
        else
          insert into public.messages(
            room_id, sender_id, body, body_json, message_type, legacy_source, legacy_message_id,
            created_at, sent_at, delivered_at, status
          ) values (
            _room_id,
            _msg.sender_id,
            _msg.content,
            jsonb_build_object('legacy_msg_type', coalesce(_msg.msg_type,'text')),
            case when coalesce(_msg.msg_type,'text') = 'file' then 'file' else coalesce(_msg.msg_type,'text') end,
            'merchant_messages',
            _msg.id::text,
            _msg.created_at,
            _msg.created_at,
            coalesce(_msg.delivered_at, _msg.read_at, _msg.created_at),
            case when _msg.read_at is not null then 'read' else 'delivered' end
          ) returning id into _new_message_id;

          if _msg.read_at is not null then
            insert into public.message_reads(room_id, message_id, user_id, read_at)
            values (_room_id, _new_message_id, _msg.sender_id, _msg.read_at)
            on conflict (message_id, user_id) do nothing;
          end if;

          insert into public.legacy_message_map(
            legacy_source, legacy_message_id, legacy_room_key, room_id, message_id, migration_status
          ) values (
            'merchant_messages', _msg.id::text, _rel.id::text, _room_id, _new_message_id, 'migrated'
          ) on conflict (legacy_source, legacy_message_id)
          do update set room_id = excluded.room_id, message_id = excluded.message_id, migration_status='repaired', updated_at = now();

          _inserted := _inserted + 1;
        end if;
      exception when others then
        _failed := _failed + 1;
        _last_error := sqlerrm;
        if not _dry_run then
          insert into public.legacy_message_map(legacy_source, legacy_message_id, legacy_room_key, migration_status, notes)
          values ('merchant_messages', _msg.id::text, _rel.id::text, 'failed', _last_error)
          on conflict (legacy_source, legacy_message_id)
          do update set migration_status='failed', notes = excluded.notes, updated_at = now();
        end if;
      end;
    end loop;
  end loop;

  insert into public.migration_audit_log(migration_name, mode, run_by, status, metrics, details)
  values (
    'fn_chat_migrate_legacy_messages',
    case when _dry_run then 'dry_run' else 'live' end,
    auth.uid(),
    case when _failed > 0 then 'warning' else 'ok' end,
    jsonb_build_object(
      'migrated', _migrated,
      'inserted', _inserted,
      'skipped', _skipped,
      'failed', _failed,
      'repaired', 0,
      'orphaned', _orphaned
    ),
    coalesce(_last_error, 'ok')
  );

  return jsonb_build_object(
    'migrated', _migrated,
    'inserted', _inserted,
    'skipped', _skipped,
    'failed', _failed,
    'repaired', 0,
    'orphaned', _orphaned,
    'dry_run', _dry_run
  );
end;
$$;

create or replace function public.fn_chat_migration_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with legacy as (
    select count(*)::int as legacy_count from public.merchant_messages
  ),
  canonical as (
    select count(*)::int as canonical_count from public.messages where legacy_source = 'merchant_messages'
  ),
  failed as (
    select count(*)::int as failed_count from public.legacy_message_map where migration_status in ('failed','orphaned')
  ),
  last_run as (
    select metrics, status, created_at from public.migration_audit_log
    where migration_name = 'fn_chat_migrate_legacy_messages'
    order by created_at desc limit 1
  )
  select jsonb_build_object(
    'legacy_count', (select legacy_count from legacy),
    'canonical_count', (select canonical_count from canonical),
    'failed_count', (select failed_count from failed),
    'last_run', coalesce((select to_jsonb(last_run.*) from last_run), '{}'::jsonb)
  );
$$;

create or replace function public.fn_chat_run_scheduled_messages(_limit int default 50)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  _row record;
  _sent int := 0;
  _msg public.messages;
begin
  for _row in
    select *
    from public.chat_scheduled_messages
    where status = 'pending'
      and run_at <= now()
    order by run_at asc
    limit greatest(coalesce(_limit, 50), 1)
  loop
    begin
      insert into public.messages(
        room_id, sender_id, body, body_json, message_type, client_nonce, status, sent_at, delivered_at
      ) values (
        _row.room_id, _row.sender_id, _row.body, _row.body_json, coalesce(_row.message_type, 'scheduled'),
        _row.client_nonce, 'sent', now(), now()
      )
      on conflict (room_id, client_nonce) where client_nonce is not null
      do update set updated_at = now()
      returning * into _msg;

      update public.chat_scheduled_messages
      set status = 'sent', sent_message_id = _msg.id
      where id = _row.id;
      _sent := _sent + 1;
    exception when others then
      update public.chat_scheduled_messages
      set status = 'failed'
      where id = _row.id;
    end;
  end loop;
  return _sent;
end;
$$;

-- convenience view for room list + unread
create or replace view public.chat_room_summary_v as
select
  cr.id as room_id,
  cr.kind,
  cr.title,
  cr.relationship_id,
  cr.updated_at,
  rm.user_id,
  rm.role as member_role,
  (select m.id from public.messages m where m.room_id = cr.id order by m.created_at desc limit 1) as last_message_id,
  (select m.body from public.messages m where m.room_id = cr.id order by m.created_at desc limit 1) as last_message_body,
  (select m.created_at from public.messages m where m.room_id = cr.id order by m.created_at desc limit 1) as last_message_at,
  (
    select count(*)::bigint
    from public.messages m
    where m.room_id = cr.id
      and m.sender_id <> rm.user_id
      and not exists (
        select 1 from public.message_reads mr where mr.message_id = m.id and mr.user_id = rm.user_id
      )
  ) as unread_count
from public.chat_rooms cr
join public.room_members rm on rm.room_id = cr.id and rm.left_at is null;

create or replace view public.message_search_v as
select
  m.id as message_id,
  m.room_id,
  m.sender_id,
  m.body,
  m.created_at,
  cr.title as room_title,
  ts_headline('simple', m.body, plainto_tsquery('simple', m.body)) as snippet
from public.messages m
join public.chat_rooms cr on cr.id = m.room_id;

create or replace view public.call_history_v as
select
  cs.id as call_session_id,
  cs.room_id,
  cs.started_by,
  cs.status,
  cs.started_at,
  cs.answered_at,
  cs.ended_at,
  cs.ended_by,
  cs.ended_reason,
  extract(epoch from (coalesce(cs.ended_at, now()) - cs.started_at))::bigint as duration_seconds,
  (
    select jsonb_agg(
      jsonb_build_object(
        'user_id', cp.user_id,
        'status', cp.status,
        'joined_at', cp.joined_at,
        'left_at', cp.left_at,
        'muted', cp.muted
      )
      order by cp.joined_at nulls last
    )
    from public.call_participants cp
    where cp.call_session_id = cs.id
  ) as participants
from public.call_sessions cs;
