import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dozmqtzlinfqjrropipb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvem1xdHpsaW5mcWpycm9waXBiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNDc4NDQsImV4cCI6MjA4OTcyMzg0NH0.dNl2x-W7BC1oCeGNE8hEnw9s7K390yHw8b2tmVFqrp0";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function seed() {
  console.log('--- Starting Seeding Process ---');

  try {
    // 1. Get a merchant profile to act as the sender
    const { data: merchant, error: merchantError } = await supabase
      .from('merchant_profiles')
      .select('merchant_id, user_id')
      .limit(1)
      .single();

    if (merchantError || !merchant) {
      console.log('No merchant profiles found. Creating a mock one.');
      // You might need to adjust this depending on your local DB state
      // For now, let's assume we need to provide a merchant_id
      const mockMerchantId = 'M-TEST-001';
      const { data: newMerchant, error: createError } = await supabase
        .from('merchant_profiles')
        .insert({
          merchant_id: mockMerchantId,
          display_name: 'Alpha Merchant',
          nickname: 'Alpha',
          user_id: '00000000-0000-0000-0000-000000000000', // Mock UUID
        })
        .select()
        .single();
      if (createError) throw createError;
      merchant = newMerchant;
    }

    console.log(`Using Merchant: ${merchant.merchant_id}`);

    // 2. Create an OS Room (Deal Type)
    const { data: room, error: roomError } = await supabase
      .from('os_rooms')
      .insert({
        name: 'Alpha Deal Negotiation',
        type: 'deal',
        lane: 'Deals',
        security_policies: {
          disable_forwarding: true,
          disable_copy: true,
          disable_export: true,
          watermark: true
        },
        retention_policy: 'indefinite'
      })
      .select()
      .single();

    if (roomError) throw roomError;
    console.log(`Created Room: ${room.id} (${room.name})`);

    // 3. Add members to the room
    await supabase.from('os_room_members').insert([
      { room_id: room.id, merchant_id: merchant.merchant_id, role: 'owner' }
    ]);

    // 4. Insert standard messages
    const { data: msg1, error: msgError1 } = await supabase
      .from('os_messages')
      .insert({
        room_id: room.id,
        sender_merchant_id: merchant.merchant_id,
        content: "Hello! I've attached the initial deal offer for the Alpha project.",
        permissions: { forwardable: false, exportable: false, copyable: false, ai_readable: true },
        retention_policy: 'indefinite'
      })
      .select()
      .single();

    if (msgError1) throw msgError1;

    // 5. Insert Business Objects (Pending Deal Offer)
    const { data: bo1, error: boError1 } = await supabase
      .from('os_business_objects')
      .insert({
        room_id: room.id,
        object_type: 'deal_offer',
        created_by_merchant_id: merchant.merchant_id,
        source_message_id: msg1.id,
        payload: {
          amount: 50000,
          currency: 'USDT',
          asset: 'Alpha-X',
          terms: 'Standard net-30 settlement.'
        },
        status: 'pending'
      })
      .select()
      .single();

    if (boError1) throw boError1;

    // 6. Insert an Immutable Snapshot (Locked Agreement)
    await supabase.from('os_messages').insert({
      room_id: room.id,
      sender_merchant_id: merchant.merchant_id,
      content: "The previous agreement has been signed and locked.",
      retention_policy: 'indefinite'
    });

    const { data: bo2, error: boError2 } = await supabase
      .from('os_business_objects')
      .insert({
        room_id: room.id,
        object_type: 'snapshot',
        created_by_merchant_id: merchant.merchant_id,
        payload: {
          contract_id: 'CTR-2026-A',
          signed_by: ['Alpha', 'Beta'],
          effective_date: '2026-03-26'
        },
        status: 'locked',
        state_snapshot_hash: 'sha256-bd7e305e5d3c8a9f0e1d2c3b4a5f6e7d8c9b0a1a2b3c4d5e6f7a8b9c0d1e2f3g'
      })
      .select()
      .single();

    if (boError2) throw boError2;

    console.log('--- Seeding Successfully Completed ---');
    console.log(`Room ID: ${room.id}`);
    console.log('You can now open this room in the chat UI to test the immutable snapshots.');

  } catch (err) {
    console.error('Seeding failed:', err);
  }
}

seed();
