import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dozmqtzlinfqjrropipb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvem1xdHpsaW5mcWpycm9waXBiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNDc4NDQsImV4cCI6MjA4OTcyMzg0NH0.dNl2x-W7BC1oCeGNE8hEnw9s7K390yHw8b2tmVFqrp0";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const UUIDS = {
  ident_wa_1: '11111111-1111-1111-1111-111111111111',
  ident_wa_2: '22222222-2222-2222-2222-222222222222',
  ident_sms_1: '33333333-3333-3333-3333-333333333333',
  ident_mail_1: '44444444-4444-4444-4444-444444444444',
  ident_tg_1: '55555555-5555-5555-5555-555555555555',
  room_personal: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  room_team: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  room_customer: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  room_deal: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  room_alert: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  msg_p1: 'f1111111-1111-1111-1111-111111111111',
  msg_t1: 'f2222222-2222-2222-2222-222222222222',
  msg_c1: 'f3333333-3333-3333-3333-333333333333',
  msg_d1: 'f4444444-4444-4444-4444-444444444444',
  msg_a1: 'f5555555-5555-5555-5555-555555555555',
  msg_ai: 'f6666666-6666-6666-6666-666666666666',
  msg_app:'f7777777-7777-7777-7777-777777777777',
};

async function seed() {
  console.log('--- Starting Messaging OS Seeding (UUID Fixed) ---');

  const { data: merchant } = await supabase.from('merchant_profiles').select('merchant_id').limit(1).single();
  const myMerchantId = merchant?.merchant_id || 'M-TEST-001';

  // 1. Setup Identities
  const identities = [
    { id: UUIDS.ident_wa_1, merchant_id: myMerchantId, provider_type: 'whatsapp', provider_uid: '+97400010001' },
    { id: UUIDS.ident_wa_2, merchant_id: myMerchantId, provider_type: 'whatsapp', provider_uid: '+97400010002' },
    { id: UUIDS.ident_sms_1, merchant_id: myMerchantId, provider_type: 'sms', provider_uid: '+97400020002' },
    { id: UUIDS.ident_mail_1, merchant_id: myMerchantId, provider_type: 'email', provider_uid: 'jassim@example.qa' },
    { id: UUIDS.ident_tg_1, merchant_id: myMerchantId, provider_type: 'telegram', provider_uid: 'fatima_qa' },
  ];

  for (const iden of identities) {
    const { error } = await supabase.from('os_channel_identities').upsert(iden);
    if (error) console.error(`Error seeding identity ${iden.id}:`, error.message);
  }

  // 2. Setup Rooms
  const rooms = [
    { id: UUIDS.room_personal, name: 'Family Weekend', lane: 'Personal', type: 'standard', security_policies: { watermark: false } },
    { id: UUIDS.room_team, name: 'DevOps & Infrastructure', lane: 'Team', type: 'standard', security_policies: { watermark: false } },
    { id: UUIDS.room_customer, name: 'Enterprise Quote #A102', lane: 'Customers', type: 'standard', security_policies: { watermark: true } },
    { id: UUIDS.room_deal, name: 'Project Falcon Acquisition', lane: 'Deals', type: 'deal', security_policies: { watermark: true, disable_copy: true, disable_forward: true } },
    { id: UUIDS.room_alert, name: 'SECURITY ALERTS: CORE', lane: 'Alerts', type: 'incident', security_policies: { watermark: false } },
  ];

  for (const room of rooms) {
    const { error } = await supabase.from('os_rooms').upsert(room);
    if (error) console.error(`Error seeding room ${room.id}:`, error.message);
  }

  // 3. Add members
  for (const room of rooms) {
    await supabase.from('os_room_members').upsert({ room_id: room.id, merchant_id: myMerchantId, role: 'owner' });
  }

  // 4. Seed Messages
  const messages = [
    { id: UUIDS.msg_p1, room_id: UUIDS.room_personal, sender_merchant_id: myMerchantId, sender_identity_id: UUIDS.ident_wa_1, content: 'Did you see the latest crypto rates?', permissions: { forwardable: true, copyable: true, message_type: 'text' } },
    { id: UUIDS.msg_t1, room_id: UUIDS.room_team, sender_merchant_id: myMerchantId, sender_identity_id: UUIDS.ident_mail_1, content: 'Attached the architecture diagram for the new gateway.', permissions: { forwardable: true, copyable: true, message_type: 'text' } },
    { id: UUIDS.msg_c1, room_id: UUIDS.room_customer, sender_merchant_id: myMerchantId, sender_identity_id: UUIDS.ident_wa_2, content: 'We need to upgrade our plan by next week.', permissions: { forwardable: true, copyable: true, message_type: 'text' } },
    { id: UUIDS.msg_d1, room_id: UUIDS.room_deal, sender_merchant_id: myMerchantId, sender_identity_id: UUIDS.ident_mail_1, content: 'CONFIDENTIAL: Our counter-offer is 2.5% equity + $100k cash.', permissions: { forwardable: false, copyable: false, message_type: 'text' } },
    { id: UUIDS.msg_a1, room_id: UUIDS.room_alert, sender_merchant_id: myMerchantId, content: '||ALERT|| Unauthorized access attempt detected on NODE-04.', permissions: { forwardable: true, copyable: true, message_type: 'system' } },
    { id: UUIDS.msg_ai, room_id: UUIDS.room_deal, sender_merchant_id: myMerchantId, content: '||AI_SUMMARY|| The parties are currently negotiating equity. Next step: legal review.', permissions: { message_type: 'ai_summary' } },
    { id: UUIDS.msg_app, room_id: UUIDS.room_team, sender_merchant_id: myMerchantId, content: '[[MiniApp: Calculator]] Result: 42', permissions: { message_type: 'app_output' } },
  ];

  for (const msg of messages) {
    const { error } = await supabase.from('os_messages').upsert(msg);
    if (error) console.error(`Error seeding message ${msg.id}:`, error.message);
  }

  console.log('--- Seeding Completed Successfully ---');
}

seed();
