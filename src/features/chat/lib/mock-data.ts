import type { ConversationSummary, ChatMessage } from '@/lib/chat-store';

export const MOCK_USER = 'user-me-123';

export const MOCK_CONVERSATIONS: ConversationSummary[] = [
  {
    relationship_id: 'rel-abu3awni1',
    counterparty_name: 'abu3awni',
    counterparty_nickname: 'abu3awni',
    last_message: '🎤 Voice message',
    last_message_at: new Date().toISOString(),
    last_sender_id: MOCK_USER,
    unread_count: 0,
    is_muted: false,
    is_pinned: false,
  },
  {
    relationship_id: 'rel-zakaria',
    counterparty_name: 'zakaria',
    counterparty_nickname: 'zakaria',
    last_message: 'z',
    last_message_at: new Date(Date.now() - 2000000).toISOString(),
    last_sender_id: MOCK_USER,
    unread_count: 0,
    is_muted: false,
    is_pinned: false,
  },
  {
    relationship_id: 'rel-tamim',
    counterparty_name: 'bu_tamim',
    counterparty_nickname: 'bu_tamim',
    last_message: 'عربي',
    last_message_at: new Date(Date.now() - 86400000).toISOString(),
    last_sender_id: MOCK_USER,
    unread_count: 0,
    is_muted: false,
    is_pinned: false,
  },
  {
    relationship_id: 'rel-farida',
    counterparty_name: 'farida',
    counterparty_nickname: 'farida',
    last_message: 'ana hena',
    last_message_at: new Date(Date.now() - 172800000).toISOString(),
    last_sender_id: MOCK_USER,
    unread_count: 0,
    is_muted: false,
    is_pinned: false,
  },
  {
    relationship_id: 'rel-abu3awni2',
    counterparty_name: 'abu3awni',
    counterparty_nickname: 'abu3awni',
    last_message: '',
    last_message_at: '',
    last_sender_id: '',
    unread_count: 0,
    is_muted: false,
    is_pinned: false,
  }
];

export const MOCK_MESSAGES: ChatMessage[] = [
  // Conversation 1 (abu3awni) matching the screenshot exactly
  {
    id: 'm1', relationship_id: 'rel-abu3awni1', sender_id: MOCK_USER, 
    content: '||VOICE||:09', read_at: new Date().toISOString(), created_at: new Date(Date.now() - 10000000).toISOString()
  },
  {
    id: 'm2', relationship_id: 'rel-abu3awni1', sender_id: 'user-abu3awni', 
    content: '||VOICE||:37', read_at: new Date().toISOString(), created_at: new Date(Date.now() - 9900000).toISOString()
  },
  {
    id: 'm3', relationship_id: 'rel-abu3awni1', sender_id: MOCK_USER, 
    content: '||VOICE||:11', read_at: new Date().toISOString(), created_at: new Date(Date.now() - 9800000).toISOString()
  },
  {
    id: 'm4', relationship_id: 'rel-abu3awni1', sender_id: 'user-abu3awni', 
    content: '||VOICE||:14', read_at: new Date().toISOString(), created_at: new Date(Date.now() - 9000000).toISOString()
  },
  {
    id: 'm5', relationship_id: 'rel-abu3awni1', sender_id: MOCK_USER, 
    content: '||VOICE||:39', read_at: new Date().toISOString(), created_at: new Date(Date.now() - 5000000).toISOString()
  },
  {
    id: 'm6', relationship_id: 'rel-abu3awni1', sender_id: MOCK_USER, 
    content: '[📎 Image: image.png]', read_at: new Date().toISOString(), created_at: new Date(Date.now() - 4000000).toISOString()
  },
  {
    id: 'm7', relationship_id: 'rel-abu3awni1', sender_id: MOCK_USER, 
    content: 'عربي بك', read_at: new Date().toISOString(), created_at: new Date(Date.now() - 3000000).toISOString()
  },
  {
    id: 'm8', relationship_id: 'rel-abu3awni1', sender_id: MOCK_USER, 
    content: '||VOICE||:06', read_at: new Date().toISOString(), created_at: new Date(Date.now() - 1500000).toISOString()
  },
  {
    id: 'm9', relationship_id: 'rel-abu3awni1', sender_id: MOCK_USER, 
    content: '||VOICE||:08', read_at: new Date().toISOString(), created_at: new Date(Date.now() - 500000).toISOString()
  }
];

export const MOCK_RELATIONSHIP = {
  id: 'rel-abu3awni1',
  counterparty_name: 'abu3awni',
  counterparty_nickname: 'abu3awni',
  counterparty_code: '8199',
  merchant_a_id: MOCK_USER,
  merchant_b_id: 'user-abu3awni',
};
