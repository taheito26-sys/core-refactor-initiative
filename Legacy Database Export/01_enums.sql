CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TYPE public.chat_call_status AS ENUM ('ringing', 'active', 'ended', 'missed', 'declined', 'failed', 'no_answer');
CREATE TYPE public.chat_encryption_mode AS ENUM ('none', 'tls_only', 'server_e2ee', 'client_e2ee');
CREATE TYPE public.chat_member_role AS ENUM ('owner', 'admin', 'member', 'guest');
CREATE TYPE public.chat_message_type AS ENUM ('text', 'voice_note', 'image', 'file', 'system', 'call_summary', 'order_card', 'payment_card', 'reaction_burst');
CREATE TYPE public.chat_room_type AS ENUM ('merchant_private', 'merchant_client', 'merchant_collab');
