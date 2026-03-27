import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://dozmqtzlinfqjrropipb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvem1xdHpsaW5mcWpycm9waXBiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNDc4NDQsImV4cCI6MjA4OTcyMzg0NH0.dNl2x-W7BC1oCeGNE8hEnw9s7K390yHw8b2tmVFqrp0";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TEST_ROOM_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'; // Targeted VIP Room
const MY_MERCHANT_ID = 'M-TEST-001';

async function seedPivotTests() {
  console.log('--- Seeding 1:1 Pivot Test Features ---');

  const testMessages = [
    {
      id: crypto.randomUUID(),
      room_id: TEST_ROOM_ID,
      sender_merchant_id: 'PARTNER-001',
      content: '||VANISH|| This is a one-time view message for security testing.',
      message_type: 'vanish',
      permissions: { vanish: true, view_count: 1 }
    },
    {
      id: crypto.randomUUID(),
      room_id: TEST_ROOM_ID,
      sender_merchant_id: 'PARTNER-001',
      content: 'This message will disappear in 24 hours. (Ephemeral Test)',
      message_type: 'text',
      permissions: { deletion_policy: '24h' },
      metadata: { expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
    },
    {
      id: crypto.randomUUID(),
      room_id: TEST_ROOM_ID,
      sender_merchant_id: 'PARTNER-001',
      content: 'Voice Call',
      message_type: 'call_history',
      payload: {
        call_type: 'voice',
        status: 'missed',
        duration: '0:00',
        started_at: new Date(Date.now() - 15 * 60 * 1000).toISOString()
      }
    },
    {
      id: crypto.randomUUID(),
      room_id: TEST_ROOM_ID,
      sender_merchant_id: 'PARTNER-001',
      content: 'Secure Video Call',
      message_type: 'call_history',
      payload: {
        call_type: 'video',
        status: 'ended',
        duration: '12:45',
        started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString()
      }
    },
    {
      id: crypto.randomUUID(),
      room_id: TEST_ROOM_ID,
      sender_merchant_id: MY_MERCHANT_ID,
      content: 'I am using the new 4-column layout. It looks very spacious!',
      message_type: 'text'
    }
  ];

  for (const msg of testMessages) {
    const { error } = await supabase.from('os_messages').upsert(msg);
    if (error) console.error(`Error seeding test message:`, error.message);
  }

  console.log('--- 1:1 Pivot Test Seeding Completed ---');
}

seedPivotTests();
