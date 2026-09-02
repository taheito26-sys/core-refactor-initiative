export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_audit_logs: {
        Row: {
          action: string
          admin_user_id: string
          created_at: string
          details: Json | null
          id: string
          target_id: string | null
          target_type: string
        }
        Insert: {
          action: string
          admin_user_id: string
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string
        }
        Update: {
          action?: string
          admin_user_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          target_id?: string | null
          target_type?: string
        }
        Relationships: []
      }
      app_config: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      app_usage_sessions: {
        Row: {
          app_version: string | null
          first_seen_at: string
          id: string
          last_seen_at: string
          platform: string
          session_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          session_id: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          app_version?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          session_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      balance_ledger: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          merchant_id: string
          note: string | null
          reference_id: string | null
          reference_type: string | null
          relationship_id: string
          type: string
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          merchant_id: string
          note?: string | null
          reference_id?: string | null
          reference_type?: string | null
          relationship_id: string
          type?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          merchant_id?: string
          note?: string | null
          reference_id?: string | null
          reference_type?: string | null
          relationship_id?: string
          type?: string
        }
        Relationships: []
      }
      buyer_statement_links: {
        Row: {
          created_at: string
          currency: string
          customer_id: string
          id: string
          revoked_at: string | null
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency: string
          customer_id: string
          id?: string
          revoked_at?: string | null
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          customer_id?: string
          id?: string
          revoked_at?: string | null
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      capital_transfers: {
        Row: {
          amount: number
          cost_basis: number
          created_at: string
          currency: string
          deal_id: string
          direction: string
          id: string
          note: string | null
          relationship_id: string
          total_cost: number
          transferred_by: string
        }
        Insert: {
          amount: number
          cost_basis: number
          created_at?: string
          currency?: string
          deal_id: string
          direction: string
          id?: string
          note?: string | null
          relationship_id: string
          total_cost: number
          transferred_by: string
        }
        Update: {
          amount?: number
          cost_basis?: number
          created_at?: string
          currency?: string
          deal_id?: string
          direction?: string
          id?: string
          note?: string | null
          relationship_id?: string
          total_cost?: number
          transferred_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "capital_transfers_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "merchant_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capital_transfers_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "merchant_relationships"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_accounts: {
        Row: {
          bank_name: string | null
          branch: string | null
          created_at: number
          currency: string
          id: string
          is_merchant_account: boolean | null
          last_reconciled: number | null
          name: string
          notes: string | null
          status: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bank_name?: string | null
          branch?: string | null
          created_at?: number
          currency: string
          id?: string
          is_merchant_account?: boolean | null
          last_reconciled?: number | null
          name: string
          notes?: string | null
          status?: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bank_name?: string | null
          branch?: string | null
          created_at?: number
          currency?: string
          id?: string
          is_merchant_account?: boolean | null
          last_reconciled?: number | null
          name?: string
          notes?: string | null
          status?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cash_custody_requests: {
        Row: {
          accepted_at: string | null
          amount: number
          counter_amount: number | null
          counter_note: string | null
          created_at: string
          currency: string
          custodian_merchant_id: string
          custodian_user_id: string | null
          id: string
          note: string | null
          rejected_at: string | null
          relationship_id: string | null
          requester_merchant_id: string
          requester_user_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          amount: number
          counter_amount?: number | null
          counter_note?: string | null
          created_at?: string
          currency?: string
          custodian_merchant_id: string
          custodian_user_id?: string | null
          id?: string
          note?: string | null
          rejected_at?: string | null
          relationship_id?: string | null
          requester_merchant_id: string
          requester_user_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          amount?: number
          counter_amount?: number | null
          counter_note?: string | null
          created_at?: string
          currency?: string
          custodian_merchant_id?: string
          custodian_user_id?: string | null
          id?: string
          note?: string | null
          rejected_at?: string | null
          relationship_id?: string | null
          requester_merchant_id?: string
          requester_user_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_custody_requests_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "merchant_relationships"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_ledger: {
        Row: {
          account_id: string
          amount: number
          batch_id: string | null
          contra_account_id: string | null
          created_at: string
          currency: string
          direction: string
          id: string
          linked_entity_id: string | null
          linked_entity_type: string | null
          note: string | null
          order_id: string | null
          ts: number
          type: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount?: number
          batch_id?: string | null
          contra_account_id?: string | null
          created_at?: string
          currency: string
          direction: string
          id?: string
          linked_entity_id?: string | null
          linked_entity_type?: string | null
          note?: string | null
          order_id?: string | null
          ts: number
          type: string
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          batch_id?: string | null
          contra_account_id?: string | null
          created_at?: string
          currency?: string
          direction?: string
          id?: string
          linked_entity_id?: string | null
          linked_entity_type?: string | null
          note?: string | null
          order_id?: string | null
          ts?: number
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_ledger_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_ledger_contra_account_id_fkey"
            columns: ["contra_account_id"]
            isOneToOne: false
            referencedRelation: "cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_ledger_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "customer_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_ledger_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "parent_order_summary"
            referencedColumns: ["parent_order_id"]
          },
        ]
      }
      chat_attachments: {
        Row: {
          auth_tag: string | null
          cdn_url: string | null
          checksum_sha256: string | null
          created_at: string
          duration_ms: number | null
          file_name: string
          file_size: number
          height: number | null
          id: string
          is_encrypted: boolean
          is_validated: boolean
          iv: string | null
          message_id: string | null
          mime_type: string
          room_id: string
          storage_path: string
          thumbnail_path: string | null
          uploader_id: string
          waveform: Json | null
          width: number | null
        }
        Insert: {
          auth_tag?: string | null
          cdn_url?: string | null
          checksum_sha256?: string | null
          created_at?: string
          duration_ms?: number | null
          file_name: string
          file_size: number
          height?: number | null
          id?: string
          is_encrypted?: boolean
          is_validated?: boolean
          iv?: string | null
          message_id?: string | null
          mime_type: string
          room_id: string
          storage_path: string
          thumbnail_path?: string | null
          uploader_id: string
          waveform?: Json | null
          width?: number | null
        }
        Update: {
          auth_tag?: string | null
          cdn_url?: string | null
          checksum_sha256?: string | null
          created_at?: string
          duration_ms?: number | null
          file_name?: string
          file_size?: number
          height?: number | null
          id?: string
          is_encrypted?: boolean
          is_validated?: boolean
          iv?: string | null
          message_id?: string | null
          mime_type?: string
          room_id?: string
          storage_path?: string
          thumbnail_path?: string | null
          uploader_id?: string
          waveform?: Json | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_attachments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_audit_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          ip_address: unknown
          metadata: Json
          room_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          room_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          room_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_audit_events_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_call_participants: {
        Row: {
          call_id: string
          ice_candidates: Json
          id: string
          joined_at: string | null
          left_at: string | null
          sdp_answer: string | null
          sdp_offer: string | null
          status: string
          user_id: string
        }
        Insert: {
          call_id: string
          ice_candidates?: Json
          id?: string
          joined_at?: string | null
          left_at?: string | null
          sdp_answer?: string | null
          sdp_offer?: string | null
          status?: string
          user_id: string
        }
        Update: {
          call_id?: string
          ice_candidates?: Json
          id?: string
          joined_at?: string | null
          left_at?: string | null
          sdp_answer?: string | null
          sdp_offer?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_call_participants_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "chat_calls"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_calls: {
        Row: {
          connected_at: string | null
          created_at: string
          duration_seconds: number | null
          end_reason: string | null
          ended_at: string | null
          ice_config: Json | null
          id: string
          initiated_by: string
          quality_stats: Json | null
          room_id: string
          signaling_channel: string | null
          started_at: string
          status: Database["public"]["Enums"]["chat_call_status"]
        }
        Insert: {
          connected_at?: string | null
          created_at?: string
          duration_seconds?: number | null
          end_reason?: string | null
          ended_at?: string | null
          ice_config?: Json | null
          id?: string
          initiated_by: string
          quality_stats?: Json | null
          room_id: string
          signaling_channel?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["chat_call_status"]
        }
        Update: {
          connected_at?: string | null
          created_at?: string
          duration_seconds?: number | null
          end_reason?: string | null
          ended_at?: string | null
          ice_config?: Json | null
          id?: string
          initiated_by?: string
          quality_stats?: Json | null
          room_id?: string
          signaling_channel?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["chat_call_status"]
        }
        Relationships: [
          {
            foreignKeyName: "chat_calls_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_device_keys: {
        Row: {
          created_at: string
          device_id: string
          id: string
          is_active: boolean
          key_id: number | null
          key_type: string
          public_key: string
          signature: string | null
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          is_active?: boolean
          key_id?: number | null
          key_type?: string
          public_key: string
          signature?: string | null
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          is_active?: boolean
          key_id?: number | null
          key_type?: string
          public_key?: string
          signature?: string | null
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      chat_direct_rooms: {
        Row: {
          created_at: string
          room_id: string
          user_a_id: string
          user_b_id: string
        }
        Insert: {
          created_at?: string
          room_id: string
          user_a_id: string
          user_b_id: string
        }
        Update: {
          created_at?: string
          room_id?: string
          user_a_id?: string
          user_b_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_direct_rooms_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: true
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_e2ee_sessions: {
        Row: {
          created_at: string
          encrypted_session_key: string
          id: string
          recipient_device_id: string
          recipient_id: string
          room_id: string
          rotated_at: string | null
          sender_device_id: string
          sender_id: string
          session_version: number
        }
        Insert: {
          created_at?: string
          encrypted_session_key: string
          id?: string
          recipient_device_id: string
          recipient_id: string
          room_id: string
          rotated_at?: string | null
          sender_device_id: string
          sender_id: string
          session_version?: number
        }
        Update: {
          created_at?: string
          encrypted_session_key?: string
          id?: string
          recipient_device_id?: string
          recipient_id?: string
          room_id?: string
          rotated_at?: string | null
          sender_device_id?: string
          sender_id?: string
          session_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "chat_e2ee_sessions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          room_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          room_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_reactions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_message_receipts: {
        Row: {
          id: string
          message_id: string
          room_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          id?: string
          message_id: string
          room_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          id?: string
          message_id?: string
          room_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_receipts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_receipts_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          client_nonce: string | null
          content: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_for_sender: boolean
          edited_at: string | null
          expires_at: string | null
          forwarded_from_id: string | null
          id: string
          is_deleted: boolean
          is_edited: boolean
          metadata: Json
          reply_to_id: string | null
          room_id: string
          search_vector: unknown
          sender_id: string
          type: Database["public"]["Enums"]["chat_message_type"]
          updated_at: string
          view_once: boolean
          viewed_by: string[]
          watermark_text: string | null
        }
        Insert: {
          client_nonce?: string | null
          content?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_for_sender?: boolean
          edited_at?: string | null
          expires_at?: string | null
          forwarded_from_id?: string | null
          id?: string
          is_deleted?: boolean
          is_edited?: boolean
          metadata?: Json
          reply_to_id?: string | null
          room_id: string
          search_vector?: unknown
          sender_id: string
          type?: Database["public"]["Enums"]["chat_message_type"]
          updated_at?: string
          view_once?: boolean
          viewed_by?: string[]
          watermark_text?: string | null
        }
        Update: {
          client_nonce?: string | null
          content?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_for_sender?: boolean
          edited_at?: string | null
          expires_at?: string | null
          forwarded_from_id?: string | null
          id?: string
          is_deleted?: boolean
          is_edited?: boolean
          metadata?: Json
          reply_to_id?: string | null
          room_id?: string
          search_vector?: unknown
          sender_id?: string
          type?: Database["public"]["Enums"]["chat_message_type"]
          updated_at?: string
          view_once?: boolean
          viewed_by?: string[]
          watermark_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_forwarded_from_id_fkey"
            columns: ["forwarded_from_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_presence: {
        Row: {
          device_info: Json
          last_seen_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          device_info?: Json
          last_seen_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          device_info?: Json
          last_seen_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_privacy_settings: {
        Row: {
          anonymous_mode: boolean
          copy_disabled: boolean
          created_at: string
          export_disabled: boolean
          forwarding_disabled: boolean
          hide_last_seen: boolean
          hide_read_receipts: boolean
          hide_typing: boolean
          invisible_mode: boolean
          notification_preview: string
          online_visibility: string
          screenshot_protection: boolean
          show_sender_in_notification: boolean
          updated_at: string
          user_id: string
          watermark_enabled: boolean
        }
        Insert: {
          anonymous_mode?: boolean
          copy_disabled?: boolean
          created_at?: string
          export_disabled?: boolean
          forwarding_disabled?: boolean
          hide_last_seen?: boolean
          hide_read_receipts?: boolean
          hide_typing?: boolean
          invisible_mode?: boolean
          notification_preview?: string
          online_visibility?: string
          screenshot_protection?: boolean
          show_sender_in_notification?: boolean
          updated_at?: string
          user_id: string
          watermark_enabled?: boolean
        }
        Update: {
          anonymous_mode?: boolean
          copy_disabled?: boolean
          created_at?: string
          export_disabled?: boolean
          forwarding_disabled?: boolean
          hide_last_seen?: boolean
          hide_read_receipts?: boolean
          hide_typing?: boolean
          invisible_mode?: boolean
          notification_preview?: string
          online_visibility?: string
          screenshot_protection?: boolean
          show_sender_in_notification?: boolean
          updated_at?: string
          user_id?: string
          watermark_enabled?: boolean
        }
        Relationships: []
      }
      chat_room_members: {
        Row: {
          display_name_override: string | null
          id: string
          invited_by: string | null
          is_archived: boolean
          is_muted: boolean
          is_pinned: boolean
          joined_at: string
          last_read_at: string | null
          last_read_message_id: string | null
          muted_until: string | null
          notification_level: string
          removed_at: string | null
          removed_by: string | null
          role: Database["public"]["Enums"]["chat_member_role"]
          room_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          display_name_override?: string | null
          id?: string
          invited_by?: string | null
          is_archived?: boolean
          is_muted?: boolean
          is_pinned?: boolean
          joined_at?: string
          last_read_at?: string | null
          last_read_message_id?: string | null
          muted_until?: string | null
          notification_level?: string
          removed_at?: string | null
          removed_by?: string | null
          role?: Database["public"]["Enums"]["chat_member_role"]
          room_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          display_name_override?: string | null
          id?: string
          invited_by?: string | null
          is_archived?: boolean
          is_muted?: boolean
          is_pinned?: boolean
          joined_at?: string
          last_read_at?: string | null
          last_read_message_id?: string | null
          muted_until?: string | null
          notification_level?: string
          removed_at?: string | null
          removed_by?: string | null
          role?: Database["public"]["Enums"]["chat_member_role"]
          room_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_room_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_room_policies: {
        Row: {
          allow_calls: boolean
          allow_files: boolean
          allow_group_calls: boolean
          allow_images: boolean
          allow_voice_notes: boolean
          allowed_mime_types: string[] | null
          created_at: string
          disable_export: boolean
          disable_forwarding: boolean
          disappearing_default_hours: number | null
          encryption_mode: Database["public"]["Enums"]["chat_encryption_mode"]
          history_searchable: boolean
          id: string
          link_preview_enabled: boolean
          max_file_size_mb: number
          moderation_level: string
          retention_hours: number | null
          room_type: Database["public"]["Enums"]["chat_room_type"]
          screenshot_protection: boolean
          strip_forward_sender_identity: boolean
          updated_at: string
          watermark_enabled: boolean
        }
        Insert: {
          allow_calls?: boolean
          allow_files?: boolean
          allow_group_calls?: boolean
          allow_images?: boolean
          allow_voice_notes?: boolean
          allowed_mime_types?: string[] | null
          created_at?: string
          disable_export?: boolean
          disable_forwarding?: boolean
          disappearing_default_hours?: number | null
          encryption_mode?: Database["public"]["Enums"]["chat_encryption_mode"]
          history_searchable?: boolean
          id?: string
          link_preview_enabled?: boolean
          max_file_size_mb?: number
          moderation_level?: string
          retention_hours?: number | null
          room_type: Database["public"]["Enums"]["chat_room_type"]
          screenshot_protection?: boolean
          strip_forward_sender_identity?: boolean
          updated_at?: string
          watermark_enabled?: boolean
        }
        Update: {
          allow_calls?: boolean
          allow_files?: boolean
          allow_group_calls?: boolean
          allow_images?: boolean
          allow_voice_notes?: boolean
          allowed_mime_types?: string[] | null
          created_at?: string
          disable_export?: boolean
          disable_forwarding?: boolean
          disappearing_default_hours?: number | null
          encryption_mode?: Database["public"]["Enums"]["chat_encryption_mode"]
          history_searchable?: boolean
          id?: string
          link_preview_enabled?: boolean
          max_file_size_mb?: number
          moderation_level?: string
          retention_hours?: number | null
          room_type?: Database["public"]["Enums"]["chat_room_type"]
          screenshot_protection?: boolean
          strip_forward_sender_identity?: boolean
          updated_at?: string
          watermark_enabled?: boolean
        }
        Relationships: []
      }
      chat_rooms: {
        Row: {
          avatar_url: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_announcement_only: boolean
          is_direct: boolean
          last_message_at: string | null
          last_message_id: string | null
          last_message_preview: string | null
          metadata: Json
          migrated_from: string | null
          migrated_source_id: string | null
          name: string | null
          policy_id: string | null
          type: Database["public"]["Enums"]["chat_room_type"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_announcement_only?: boolean
          is_direct?: boolean
          last_message_at?: string | null
          last_message_id?: string | null
          last_message_preview?: string | null
          metadata?: Json
          migrated_from?: string | null
          migrated_source_id?: string | null
          name?: string | null
          policy_id?: string | null
          type: Database["public"]["Enums"]["chat_room_type"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_announcement_only?: boolean
          is_direct?: boolean
          last_message_at?: string | null
          last_message_id?: string | null
          last_message_preview?: string | null
          metadata?: Json
          migrated_from?: string | null
          migrated_source_id?: string | null
          name?: string | null
          policy_id?: string | null
          type?: Database["public"]["Enums"]["chat_room_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_rooms_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "chat_room_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_typing_state: {
        Row: {
          expires_at: string
          is_typing: boolean
          room_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          expires_at?: string
          is_typing?: boolean
          room_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          expires_at?: string
          is_typing?: boolean
          room_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_typing_state_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_user_privacy_settings: {
        Row: {
          anonymous_mode: boolean
          copy_disabled: boolean
          export_disabled: boolean
          forwarding_disabled: boolean
          hide_last_seen: boolean
          hide_read_receipts: boolean
          hide_typing: boolean
          invisible_mode: boolean
          notification_preview: string
          online_visibility: string
          screenshot_protection: boolean
          show_sender_in_notification: boolean
          updated_at: string
          user_id: string
          watermark_enabled: boolean
        }
        Insert: {
          anonymous_mode?: boolean
          copy_disabled?: boolean
          export_disabled?: boolean
          forwarding_disabled?: boolean
          hide_last_seen?: boolean
          hide_read_receipts?: boolean
          hide_typing?: boolean
          invisible_mode?: boolean
          notification_preview?: string
          online_visibility?: string
          screenshot_protection?: boolean
          show_sender_in_notification?: boolean
          updated_at?: string
          user_id: string
          watermark_enabled?: boolean
        }
        Update: {
          anonymous_mode?: boolean
          copy_disabled?: boolean
          export_disabled?: boolean
          forwarding_disabled?: boolean
          hide_last_seen?: boolean
          hide_read_receipts?: boolean
          hide_typing?: boolean
          invisible_mode?: boolean
          notification_preview?: string
          online_visibility?: string
          screenshot_protection?: boolean
          show_sender_in_notification?: boolean
          updated_at?: string
          user_id?: string
          watermark_enabled?: boolean
        }
        Relationships: []
      }
      conversation_settings: {
        Row: {
          created_at: string
          id: string
          is_archived: boolean
          is_muted: boolean
          is_pinned: boolean
          muted_until: string | null
          relationship_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_archived?: boolean
          is_muted?: boolean
          is_pinned?: boolean
          muted_until?: string | null
          relationship_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_archived?: boolean
          is_muted?: boolean
          is_pinned?: boolean
          muted_until?: string | null
          relationship_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_settings_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "merchant_relationships"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_merchant_connections: {
        Row: {
          created_at: string
          customer_user_id: string
          id: string
          is_preferred: boolean
          merchant_id: string
          nickname: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_user_id: string
          id?: string
          is_preferred?: boolean
          merchant_id: string
          nickname?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_user_id?: string
          id?: string
          is_preferred?: boolean
          merchant_id?: string
          nickname?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_messages: {
        Row: {
          connection_id: string
          content: string
          created_at: string
          id: string
          read_at: string | null
          sender_role: string
          sender_user_id: string
        }
        Insert: {
          connection_id: string
          content: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_role?: string
          sender_user_id: string
        }
        Update: {
          connection_id?: string
          content?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_role?: string
          sender_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_messages_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "customer_merchant_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_order_cash_links: {
        Row: {
          amount: number | null
          cash_account_id: string | null
          created_at: string
          currency: string | null
          id: string
          link_kind: string
          order_id: string
          owner_role: string
        }
        Insert: {
          amount?: number | null
          cash_account_id?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          link_kind: string
          order_id: string
          owner_role: string
        }
        Update: {
          amount?: number | null
          cash_account_id?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          link_kind?: string
          order_id?: string
          owner_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_order_cash_links_cash_account_id_fkey"
            columns: ["cash_account_id"]
            isOneToOne: false
            referencedRelation: "cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_order_cash_links_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "customer_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_order_cash_links_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "parent_order_summary"
            referencedColumns: ["parent_order_id"]
          },
        ]
      }
      customer_order_events: {
        Row: {
          actor_user_id: string
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          order_id: string
        }
        Insert: {
          actor_user_id: string
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          order_id: string
        }
        Update: {
          actor_user_id?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "customer_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "parent_order_summary"
            referencedColumns: ["parent_order_id"]
          },
        ]
      }
      customer_orders: {
        Row: {
          amount: number
          approval_required_from_role: string | null
          approved_at: string | null
          approved_by_user_id: string | null
          confirmed_at: string | null
          connection_id: string
          corridor_label: string | null
          created_at: string
          currency: string
          customer_accepted_quote_at: string | null
          customer_rejected_quote_at: string | null
          customer_user_id: string
          destination_cash_account_id: string | null
          edited_from_order_id: string | null
          expires_at: string | null
          final_quote_expires_at: string | null
          final_quote_note: string | null
          final_rate: number | null
          final_total: number | null
          fulfillment_mode: string | null
          fx_rate: number | null
          guide_generated_at: string | null
          guide_rate: number | null
          guide_snapshot: Json | null
          guide_source: string | null
          guide_total: number | null
          id: string
          market_pair: string | null
          merchant_id: string
          mirror_error_reason: string | null
          mirror_status: string | null
          note: string | null
          order_type: string
          payment_proof_uploaded_at: string | null
          payment_proof_url: string | null
          payout_rail: string | null
          placed_by_role: string | null
          placed_by_user_id: string | null
          pricing_mode: string | null
          pricing_version: string | null
          quote_rejection_reason: string | null
          quoted_at: string | null
          quoted_by_user_id: string | null
          rate: number | null
          receive_country: string | null
          receive_currency: string | null
          rejected_at: string | null
          rejected_by_user_id: string | null
          rejection_reason: string | null
          required_usdt: number | null
          revision_no: number
          send_country: string | null
          send_currency: string | null
          status: string
          total: number | null
          updated_at: string
          usdt_qar_rate: number | null
          workflow_status: string | null
        }
        Insert: {
          amount: number
          approval_required_from_role?: string | null
          approved_at?: string | null
          approved_by_user_id?: string | null
          confirmed_at?: string | null
          connection_id: string
          corridor_label?: string | null
          created_at?: string
          currency?: string
          customer_accepted_quote_at?: string | null
          customer_rejected_quote_at?: string | null
          customer_user_id: string
          destination_cash_account_id?: string | null
          edited_from_order_id?: string | null
          expires_at?: string | null
          final_quote_expires_at?: string | null
          final_quote_note?: string | null
          final_rate?: number | null
          final_total?: number | null
          fulfillment_mode?: string | null
          fx_rate?: number | null
          guide_generated_at?: string | null
          guide_rate?: number | null
          guide_snapshot?: Json | null
          guide_source?: string | null
          guide_total?: number | null
          id?: string
          market_pair?: string | null
          merchant_id: string
          mirror_error_reason?: string | null
          mirror_status?: string | null
          note?: string | null
          order_type?: string
          payment_proof_uploaded_at?: string | null
          payment_proof_url?: string | null
          payout_rail?: string | null
          placed_by_role?: string | null
          placed_by_user_id?: string | null
          pricing_mode?: string | null
          pricing_version?: string | null
          quote_rejection_reason?: string | null
          quoted_at?: string | null
          quoted_by_user_id?: string | null
          rate?: number | null
          receive_country?: string | null
          receive_currency?: string | null
          rejected_at?: string | null
          rejected_by_user_id?: string | null
          rejection_reason?: string | null
          required_usdt?: number | null
          revision_no?: number
          send_country?: string | null
          send_currency?: string | null
          status?: string
          total?: number | null
          updated_at?: string
          usdt_qar_rate?: number | null
          workflow_status?: string | null
        }
        Update: {
          amount?: number
          approval_required_from_role?: string | null
          approved_at?: string | null
          approved_by_user_id?: string | null
          confirmed_at?: string | null
          connection_id?: string
          corridor_label?: string | null
          created_at?: string
          currency?: string
          customer_accepted_quote_at?: string | null
          customer_rejected_quote_at?: string | null
          customer_user_id?: string
          destination_cash_account_id?: string | null
          edited_from_order_id?: string | null
          expires_at?: string | null
          final_quote_expires_at?: string | null
          final_quote_note?: string | null
          final_rate?: number | null
          final_total?: number | null
          fulfillment_mode?: string | null
          fx_rate?: number | null
          guide_generated_at?: string | null
          guide_rate?: number | null
          guide_snapshot?: Json | null
          guide_source?: string | null
          guide_total?: number | null
          id?: string
          market_pair?: string | null
          merchant_id?: string
          mirror_error_reason?: string | null
          mirror_status?: string | null
          note?: string | null
          order_type?: string
          payment_proof_uploaded_at?: string | null
          payment_proof_url?: string | null
          payout_rail?: string | null
          placed_by_role?: string | null
          placed_by_user_id?: string | null
          pricing_mode?: string | null
          pricing_version?: string | null
          quote_rejection_reason?: string | null
          quoted_at?: string | null
          quoted_by_user_id?: string | null
          rate?: number | null
          receive_country?: string | null
          receive_currency?: string | null
          rejected_at?: string | null
          rejected_by_user_id?: string | null
          rejection_reason?: string | null
          required_usdt?: number | null
          revision_no?: number
          send_country?: string | null
          send_currency?: string | null
          status?: string
          total?: number | null
          updated_at?: string
          usdt_qar_rate?: number | null
          workflow_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_orders_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "customer_merchant_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_profiles: {
        Row: {
          country: string | null
          created_at: string
          display_name: string
          id: string
          phone: string | null
          preferred_currency: string
          region: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          display_name: string
          id?: string
          phone?: string | null
          preferred_currency?: string
          region?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          country?: string | null
          created_at?: string
          display_name?: string
          id?: string
          phone?: string | null
          preferred_currency?: string
          region?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      customer_settlement_events: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          reference: string | null
          settled_amount: number | null
          settlement_id: string | null
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          reference?: string | null
          settled_amount?: number | null
          settlement_id?: string | null
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          reference?: string | null
          settled_amount?: number | null
          settlement_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_settlement_events_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "customer_settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_settlements: {
        Row: {
          beneficiary_account: string | null
          beneficiary_bank: string | null
          beneficiary_name: string | null
          bridge_amount: number | null
          bridge_currency: string
          completed_at: string | null
          created_at: string | null
          customer_order_id: string
          customer_user_id: string
          destination_amount_expected: number
          destination_amount_settled: number
          destination_currency: string
          effective_rate: number | null
          id: string
          source_amount: number
          source_currency: string
          status: string
        }
        Insert: {
          beneficiary_account?: string | null
          beneficiary_bank?: string | null
          beneficiary_name?: string | null
          bridge_amount?: number | null
          bridge_currency?: string
          completed_at?: string | null
          created_at?: string | null
          customer_order_id: string
          customer_user_id: string
          destination_amount_expected: number
          destination_amount_settled?: number
          destination_currency?: string
          effective_rate?: number | null
          id?: string
          source_amount: number
          source_currency?: string
          status?: string
        }
        Update: {
          beneficiary_account?: string | null
          beneficiary_bank?: string | null
          beneficiary_name?: string | null
          bridge_amount?: number | null
          bridge_currency?: string
          completed_at?: string | null
          created_at?: string | null
          customer_order_id?: string
          customer_user_id?: string
          destination_amount_expected?: number
          destination_amount_settled?: number
          destination_currency?: string
          effective_rate?: number | null
          id?: string
          source_amount?: number
          source_currency?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_settlements_customer_order_id_fkey"
            columns: ["customer_order_id"]
            isOneToOne: false
            referencedRelation: "customer_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_settlements_customer_order_id_fkey"
            columns: ["customer_order_id"]
            isOneToOne: false
            referencedRelation: "parent_order_summary"
            referencedColumns: ["parent_order_id"]
          },
        ]
      }
      daily_reference_rates: {
        Row: {
          created_at: string
          id: string
          rate_date: string
          recorded_by: string
          source: string
          total_cost_basis_qar: number
          total_usdt_stock: number
          wacop_rate: number
        }
        Insert: {
          created_at?: string
          id?: string
          rate_date: string
          recorded_by: string
          source?: string
          total_cost_basis_qar?: number
          total_usdt_stock?: number
          wacop_rate: number
        }
        Update: {
          created_at?: string
          id?: string
          rate_date?: string
          recorded_by?: string
          source?: string
          total_cost_basis_qar?: number
          total_usdt_stock?: number
          wacop_rate?: number
        }
        Relationships: []
      }
      deal_capital: {
        Row: {
          amount: number
          created_at: string
          currency: string
          deal_id: string
          id: string
          merchant_id: string
          relationship_id: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          deal_id: string
          id?: string
          merchant_id: string
          relationship_id: string
          status?: string
          type?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          deal_id?: string
          id?: string
          merchant_id?: string
          relationship_id?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      deal_capital_ledger: {
        Row: {
          amount: number
          created_at: string
          currency: string
          deal_id: string
          id: string
          initiated_by: string
          note: string | null
          original_entry_id: string | null
          period_id: string | null
          pool_balance_after: number
          relationship_id: string
          type: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          deal_id: string
          id?: string
          initiated_by: string
          note?: string | null
          original_entry_id?: string | null
          period_id?: string | null
          pool_balance_after?: number
          relationship_id: string
          type: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          deal_id?: string
          id?: string
          initiated_by?: string
          note?: string | null
          original_entry_id?: string | null
          period_id?: string | null
          pool_balance_after?: number
          relationship_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_capital_ledger_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "merchant_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_capital_ledger_original_entry_id_fkey"
            columns: ["original_entry_id"]
            isOneToOne: false
            referencedRelation: "deal_capital_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_capital_ledger_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "settlement_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_capital_ledger_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "merchant_relationships"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_balances: {
        Row: {
          account_type: string
          asset: string
          exchange: string
          free: number
          id: string
          locked: number
          updated_at: string
          user_id: string
        }
        Insert: {
          account_type: string
          asset: string
          exchange: string
          free?: number
          id?: string
          locked?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          account_type?: string
          asset?: string
          exchange?: string
          free?: number
          id?: string
          locked?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      exchange_counterparty_map: {
        Row: {
          counterparty_name: string
          created_at: string
          entity_id: string | null
          entity_name: string
          entity_type: string
          exchange: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          counterparty_name: string
          created_at?: string
          entity_id?: string | null
          entity_name: string
          entity_type: string
          exchange: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          counterparty_name?: string
          created_at?: string
          entity_id?: string | null
          entity_name?: string
          entity_type?: string
          exchange?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      exchange_credentials: {
        Row: {
          api_key: string
          api_secret: string
          created_at: string
          exchange: string
          id: string
          label: string | null
          last_sync_error: string | null
          last_synced_at: string | null
          passphrase: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key: string
          api_secret: string
          created_at?: string
          exchange: string
          id?: string
          label?: string | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          passphrase?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string
          api_secret?: string
          created_at?: string
          exchange?: string
          id?: string
          label?: string | null
          last_sync_error?: string | null
          last_synced_at?: string | null
          passphrase?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      exchange_p2p_orders: {
        Row: {
          amount: number
          asset: string
          counterparty: string | null
          created_at: string
          exchange: string
          fiat: string
          id: string
          linked_at: string | null
          linked_entity_id: string | null
          linked_entity_type: string | null
          order_number: string
          order_time: string | null
          price: number
          raw: Json | null
          side: string
          status: string
          total: number
          user_id: string
        }
        Insert: {
          amount: number
          asset: string
          counterparty?: string | null
          created_at?: string
          exchange: string
          fiat: string
          id?: string
          linked_at?: string | null
          linked_entity_id?: string | null
          linked_entity_type?: string | null
          order_number: string
          order_time?: string | null
          price: number
          raw?: Json | null
          side: string
          status: string
          total: number
          user_id: string
        }
        Update: {
          amount?: number
          asset?: string
          counterparty?: string | null
          created_at?: string
          exchange?: string
          fiat?: string
          id?: string
          linked_at?: string | null
          linked_entity_id?: string | null
          linked_entity_type?: string | null
          order_number?: string
          order_time?: string | null
          price?: number
          raw?: Json | null
          side?: string
          status?: string
          total?: number
          user_id?: string
        }
        Relationships: []
      }
      exchange_transfers: {
        Row: {
          amount: number
          asset: string
          counterparty: string | null
          created_at: string
          direction: string
          exchange: string
          id: string
          kind: string
          linked_at: string | null
          linked_entity_id: string | null
          linked_entity_type: string | null
          network: string | null
          raw: Json | null
          reference: string
          status: string
          transfer_time: string | null
          user_id: string
        }
        Insert: {
          amount: number
          asset: string
          counterparty?: string | null
          created_at?: string
          direction: string
          exchange: string
          id?: string
          kind: string
          linked_at?: string | null
          linked_entity_id?: string | null
          linked_entity_type?: string | null
          network?: string | null
          raw?: Json | null
          reference: string
          status: string
          transfer_time?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          asset?: string
          counterparty?: string | null
          created_at?: string
          direction?: string
          exchange?: string
          id?: string
          kind?: string
          linked_at?: string | null
          linked_entity_id?: string | null
          linked_entity_type?: string | null
          network?: string | null
          raw?: Json | null
          reference?: string
          status?: string
          transfer_time?: string | null
          user_id?: string
        }
        Relationships: []
      }
      fx_rates: {
        Row: {
          created_at: string
          fetched_at: string
          id: string
          rate: number
          source: string
          source_currency: string
          target_currency: string
        }
        Insert: {
          created_at?: string
          fetched_at?: string
          id?: string
          rate: number
          source?: string
          source_currency: string
          target_currency: string
        }
        Update: {
          created_at?: string
          fetched_at?: string
          id?: string
          rate?: number
          source?: string
          source_currency?: string
          target_currency?: string
        }
        Relationships: []
      }
      gas_log: {
        Row: {
          action: string
          created_at: string
          gas_used: number
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          gas_used?: number
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          gas_used?: number
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      market_offers: {
        Row: {
          created_at: string
          created_by: string | null
          currency_pair: string
          expires_at: string | null
          id: string
          max_amount: number
          merchant_id: string
          min_amount: number
          note: string | null
          offer_type: string
          rate: number
          room_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency_pair?: string
          expires_at?: string | null
          id?: string
          max_amount?: number
          merchant_id: string
          min_amount?: number
          note?: string | null
          offer_type: string
          rate: number
          room_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency_pair?: string
          expires_at?: string | null
          id?: string
          max_amount?: number
          merchant_id?: string
          min_amount?: number
          note?: string | null
          offer_type?: string
          rate?: number
          room_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_offers_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_approvals: {
        Row: {
          created_at: string
          id: string
          relationship_id: string
          resolution_note: string | null
          reviewer_id: string | null
          status: string
          submitted_by: string
          target_entity_id: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          relationship_id: string
          resolution_note?: string | null
          reviewer_id?: string | null
          status?: string
          submitted_by: string
          target_entity_id: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          relationship_id?: string
          resolution_note?: string | null
          reviewer_id?: string | null
          status?: string
          submitted_by?: string
          target_entity_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_approvals_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "merchant_relationships"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_deals: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          currency: string
          deal_type: string
          id: string
          metadata: Json | null
          notes: string | null
          realized_pnl: number
          relationship_id: string
          settlement_cadence: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          currency?: string
          deal_type?: string
          id?: string
          metadata?: Json | null
          notes?: string | null
          realized_pnl?: number
          relationship_id: string
          settlement_cadence?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          currency?: string
          deal_type?: string
          id?: string
          metadata?: Json | null
          notes?: string | null
          realized_pnl?: number
          relationship_id?: string
          settlement_cadence?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_deals_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "merchant_relationships"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_invites: {
        Row: {
          created_at: string
          expires_at: string
          from_merchant_id: string
          id: string
          message: string | null
          status: string
          to_merchant_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          from_merchant_id: string
          id?: string
          message?: string | null
          status?: string
          to_merchant_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          from_merchant_id?: string
          id?: string
          message?: string | null
          status?: string
          to_merchant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_invites_from_merchant_id_fkey"
            columns: ["from_merchant_id"]
            isOneToOne: false
            referencedRelation: "merchant_profiles"
            referencedColumns: ["merchant_id"]
          },
          {
            foreignKeyName: "merchant_invites_to_merchant_id_fkey"
            columns: ["to_merchant_id"]
            isOneToOne: false
            referencedRelation: "merchant_profiles"
            referencedColumns: ["merchant_id"]
          },
        ]
      }
      merchant_liquidity_profiles: {
        Row: {
          auto_sync_enabled: boolean
          cash_publish_mode: string
          cash_range_max: number | null
          cash_range_min: number | null
          cash_status: string
          created_at: string
          expires_at: string | null
          id: string
          last_published_at: string | null
          merchant_id: string
          publish_cash_enabled: boolean
          publish_usdt_enabled: boolean
          published_cash_amount: number | null
          published_usdt_amount: number | null
          reserve_buffer_cash: number
          reserve_buffer_usdt: number
          reserved_cash_commitments: number
          reserved_usdt_commitments: number
          status: string
          updated_at: string
          usdt_publish_mode: string
          usdt_range_max: number | null
          usdt_range_min: number | null
          usdt_status: string
          user_id: string
          visibility_scope: string
        }
        Insert: {
          auto_sync_enabled?: boolean
          cash_publish_mode?: string
          cash_range_max?: number | null
          cash_range_min?: number | null
          cash_status?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_published_at?: string | null
          merchant_id: string
          publish_cash_enabled?: boolean
          publish_usdt_enabled?: boolean
          published_cash_amount?: number | null
          published_usdt_amount?: number | null
          reserve_buffer_cash?: number
          reserve_buffer_usdt?: number
          reserved_cash_commitments?: number
          reserved_usdt_commitments?: number
          status?: string
          updated_at?: string
          usdt_publish_mode?: string
          usdt_range_max?: number | null
          usdt_range_min?: number | null
          usdt_status?: string
          user_id: string
          visibility_scope?: string
        }
        Update: {
          auto_sync_enabled?: boolean
          cash_publish_mode?: string
          cash_range_max?: number | null
          cash_range_min?: number | null
          cash_status?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_published_at?: string | null
          merchant_id?: string
          publish_cash_enabled?: boolean
          publish_usdt_enabled?: boolean
          published_cash_amount?: number | null
          published_usdt_amount?: number | null
          reserve_buffer_cash?: number
          reserve_buffer_usdt?: number
          reserved_cash_commitments?: number
          reserved_usdt_commitments?: number
          status?: string
          updated_at?: string
          usdt_publish_mode?: string
          usdt_range_max?: number | null
          usdt_range_min?: number | null
          usdt_status?: string
          user_id?: string
          visibility_scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_liquidity_profiles_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: true
            referencedRelation: "merchant_profiles"
            referencedColumns: ["merchant_id"]
          },
        ]
      }
      merchant_messages: {
        Row: {
          content: string
          created_at: string
          delivered_at: string | null
          edited_at: string | null
          id: string
          metadata: Json | null
          msg_type: string
          read_at: string | null
          relationship_id: string
          reply_to: string | null
          sender_id: string
        }
        Insert: {
          content: string
          created_at?: string
          delivered_at?: string | null
          edited_at?: string | null
          id?: string
          metadata?: Json | null
          msg_type?: string
          read_at?: string | null
          relationship_id: string
          reply_to?: string | null
          sender_id: string
        }
        Update: {
          content?: string
          created_at?: string
          delivered_at?: string | null
          edited_at?: string | null
          id?: string
          metadata?: Json | null
          msg_type?: string
          read_at?: string | null
          relationship_id?: string
          reply_to?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_messages_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "merchant_relationships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_messages_reply_to_fkey"
            columns: ["reply_to"]
            isOneToOne: false
            referencedRelation: "merchant_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          default_currency: string
          discoverability: string
          display_name: string
          id: string
          merchant_code: string | null
          merchant_id: string
          nickname: string
          otc_avg_rating: number
          otc_completed_trades: number
          otc_completion_rate: number
          otc_reputation_updated_at: string | null
          otc_review_count: number
          otc_total_volume: number
          region: string | null
          status: string
          updated_at: string
          user_id: string
          verification_tier: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          default_currency?: string
          discoverability?: string
          display_name: string
          id?: string
          merchant_code?: string | null
          merchant_id: string
          nickname: string
          otc_avg_rating?: number
          otc_completed_trades?: number
          otc_completion_rate?: number
          otc_reputation_updated_at?: string | null
          otc_review_count?: number
          otc_total_volume?: number
          region?: string | null
          status?: string
          updated_at?: string
          user_id: string
          verification_tier?: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          default_currency?: string
          discoverability?: string
          display_name?: string
          id?: string
          merchant_code?: string | null
          merchant_id?: string
          nickname?: string
          otc_avg_rating?: number
          otc_completed_trades?: number
          otc_completion_rate?: number
          otc_reputation_updated_at?: string | null
          otc_review_count?: number
          otc_total_volume?: number
          region?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          verification_tier?: string
        }
        Relationships: []
      }
      merchant_profits: {
        Row: {
          amount: number
          created_at: string
          currency: string
          deal_id: string
          id: string
          notes: string | null
          recorded_by: string
          relationship_id: string | null
          status: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          deal_id: string
          id?: string
          notes?: string | null
          recorded_by: string
          relationship_id?: string | null
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          deal_id?: string
          id?: string
          notes?: string | null
          recorded_by?: string
          relationship_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_profits_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "merchant_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_profits_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "merchant_relationships"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_relationships: {
        Row: {
          created_at: string
          id: string
          merchant_a_id: string
          merchant_b_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          merchant_a_id: string
          merchant_b_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          merchant_a_id?: string
          merchant_b_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_relationships_merchant_a_id_fkey"
            columns: ["merchant_a_id"]
            isOneToOne: false
            referencedRelation: "merchant_profiles"
            referencedColumns: ["merchant_id"]
          },
          {
            foreignKeyName: "merchant_relationships_merchant_b_id_fkey"
            columns: ["merchant_b_id"]
            isOneToOne: false
            referencedRelation: "merchant_profiles"
            referencedColumns: ["merchant_id"]
          },
        ]
      }
      merchant_settlements: {
        Row: {
          amount: number
          created_at: string
          currency: string
          deal_id: string
          id: string
          notes: string | null
          relationship_id: string | null
          settled_by: string
          status: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          deal_id: string
          id?: string
          notes?: string | null
          relationship_id?: string | null
          settled_by: string
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          deal_id?: string
          id?: string
          notes?: string | null
          relationship_id?: string | null
          settled_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_settlements_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "merchant_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_settlements_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "merchant_relationships"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          created_at: string
          id: string
          message_id: string
          reaction: string
          room_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          reaction: string
          room_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          reaction?: string
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "os_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_room_summary_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "os_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          anchor_id: string | null
          body: string | null
          category: string
          conversation_id: string | null
          created_at: string
          dedupe_key: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          message_id: string | null
          read_at: string | null
          target_entity_id: string | null
          target_entity_type: string | null
          target_focus: string | null
          target_path: string | null
          target_tab: string | null
          title: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          anchor_id?: string | null
          body?: string | null
          category?: string
          conversation_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message_id?: string | null
          read_at?: string | null
          target_entity_id?: string | null
          target_entity_type?: string | null
          target_focus?: string | null
          target_path?: string | null
          target_tab?: string | null
          title: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          anchor_id?: string | null
          body?: string | null
          category?: string
          conversation_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message_id?: string | null
          read_at?: string | null
          target_entity_id?: string | null
          target_entity_type?: string | null
          target_focus?: string | null
          target_path?: string | null
          target_tab?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      order_allocations: {
        Row: {
          agreement_ratio_snapshot: string | null
          allocated_usdt: number
          allocation_cost: number
          allocation_fee: number
          allocation_net: number
          allocation_revenue: number
          created_at: string
          deal_terms_snapshot: Json | null
          family: string
          fee_share: number
          id: string
          merchant_amount: number
          merchant_cost_per_usdt: number
          merchant_id: string
          merchant_share_pct: number
          note: string | null
          order_id: string
          partner_amount: number
          partner_share_pct: number
          profit_share_agreement_id: string | null
          relationship_id: string
          sale_group_id: string
          sell_price: number
          status: string
          updated_at: string
        }
        Insert: {
          agreement_ratio_snapshot?: string | null
          allocated_usdt?: number
          allocation_cost?: number
          allocation_fee?: number
          allocation_net?: number
          allocation_revenue?: number
          created_at?: string
          deal_terms_snapshot?: Json | null
          family: string
          fee_share?: number
          id?: string
          merchant_amount?: number
          merchant_cost_per_usdt?: number
          merchant_id: string
          merchant_share_pct?: number
          note?: string | null
          order_id: string
          partner_amount?: number
          partner_share_pct?: number
          profit_share_agreement_id?: string | null
          relationship_id: string
          sale_group_id: string
          sell_price?: number
          status?: string
          updated_at?: string
        }
        Update: {
          agreement_ratio_snapshot?: string | null
          allocated_usdt?: number
          allocation_cost?: number
          allocation_fee?: number
          allocation_net?: number
          allocation_revenue?: number
          created_at?: string
          deal_terms_snapshot?: Json | null
          family?: string
          fee_share?: number
          id?: string
          merchant_amount?: number
          merchant_cost_per_usdt?: number
          merchant_id?: string
          merchant_share_pct?: number
          note?: string | null
          order_id?: string
          partner_amount?: number
          partner_share_pct?: number
          profit_share_agreement_id?: string | null
          relationship_id?: string
          sale_group_id?: string
          sell_price?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_allocations_profit_share_agreement_id_fkey"
            columns: ["profit_share_agreement_id"]
            isOneToOne: false
            referencedRelation: "profit_share_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_allocations_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "merchant_relationships"
            referencedColumns: ["id"]
          },
        ]
      }
      order_executions: {
        Row: {
          cash_account_id: string | null
          created_at: string
          created_by: string
          egp_per_usdt: number | null
          egp_received_amount: number | null
          executed_at: string
          executed_egp: number | null
          fx_rate_qar_to_egp: number
          id: string
          market_type: string
          parent_order_id: string
          phase_consumed_qar: number | null
          phase_qar_egp_fx: number | null
          phase_usdt: number | null
          sequence_number: number
          sold_qar_amount: number
          status: string
          updated_at: string
        }
        Insert: {
          cash_account_id?: string | null
          created_at?: string
          created_by: string
          egp_per_usdt?: number | null
          egp_received_amount?: number | null
          executed_at?: string
          executed_egp?: number | null
          fx_rate_qar_to_egp: number
          id?: string
          market_type?: string
          parent_order_id: string
          phase_consumed_qar?: number | null
          phase_qar_egp_fx?: number | null
          phase_usdt?: number | null
          sequence_number: number
          sold_qar_amount: number
          status?: string
          updated_at?: string
        }
        Update: {
          cash_account_id?: string | null
          created_at?: string
          created_by?: string
          egp_per_usdt?: number | null
          egp_received_amount?: number | null
          executed_at?: string
          executed_egp?: number | null
          fx_rate_qar_to_egp?: number
          id?: string
          market_type?: string
          parent_order_id?: string
          phase_consumed_qar?: number | null
          phase_qar_egp_fx?: number | null
          phase_usdt?: number | null
          sequence_number?: number
          sold_qar_amount?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_executions_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "customer_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_executions_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "parent_order_summary"
            referencedColumns: ["parent_order_id"]
          },
        ]
      }
      os_audit_events: {
        Row: {
          actor_merchant_id: string
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          room_id: string | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          actor_merchant_id: string
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          room_id?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          actor_merchant_id?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          room_id?: string | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "os_audit_events_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_room_summary_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_audit_events_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "os_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      os_business_objects: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_merchant_id: string | null
          id: string
          object_type: string
          payload: Json
          room_id: string
          source_message_id: string | null
          state_snapshot_hash: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_merchant_id?: string | null
          id?: string
          object_type: string
          payload?: Json
          room_id: string
          source_message_id?: string | null
          state_snapshot_hash?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_merchant_id?: string | null
          id?: string
          object_type?: string
          payload?: Json
          room_id?: string
          source_message_id?: string | null
          state_snapshot_hash?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "os_business_objects_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_room_summary_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_business_objects_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "os_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_business_objects_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "os_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      os_channel_identities: {
        Row: {
          confidence_level: string | null
          created_at: string
          display_name: string | null
          id: string
          merchant_id: string | null
          provider_type: string
          provider_uid: string | null
          provider_user_id: string | null
          updated_at: string
        }
        Insert: {
          confidence_level?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          merchant_id?: string | null
          provider_type: string
          provider_uid?: string | null
          provider_user_id?: string | null
          updated_at?: string
        }
        Update: {
          confidence_level?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          merchant_id?: string | null
          provider_type?: string
          provider_uid?: string | null
          provider_user_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      os_direct_rooms: {
        Row: {
          created_at: string
          merchant_a_id: string
          merchant_b_id: string
          room_id: string
        }
        Insert: {
          created_at?: string
          merchant_a_id: string
          merchant_b_id: string
          room_id: string
        }
        Update: {
          created_at?: string
          merchant_a_id?: string
          merchant_b_id?: string
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "os_direct_rooms_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: true
            referencedRelation: "chat_room_summary_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_direct_rooms_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: true
            referencedRelation: "os_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      os_messages: {
        Row: {
          body_json: Json
          client_nonce: string | null
          content: string
          created_at: string
          deleted_at: string | null
          expires_at: string | null
          id: string
          is_deleted: boolean
          is_pinned: boolean
          message_type: string
          permissions: Json
          pinned_at: string | null
          pinned_by: string | null
          read_at: string | null
          reply_to_message_id: string | null
          retention_policy: string
          room_id: string
          sender_id: string | null
          sender_identity_id: string | null
          sender_merchant_id: string
          status: string
          thread_id: string | null
          updated_at: string
          view_limit: number | null
        }
        Insert: {
          body_json?: Json
          client_nonce?: string | null
          content?: string
          created_at?: string
          deleted_at?: string | null
          expires_at?: string | null
          id?: string
          is_deleted?: boolean
          is_pinned?: boolean
          message_type?: string
          permissions?: Json
          pinned_at?: string | null
          pinned_by?: string | null
          read_at?: string | null
          reply_to_message_id?: string | null
          retention_policy?: string
          room_id: string
          sender_id?: string | null
          sender_identity_id?: string | null
          sender_merchant_id: string
          status?: string
          thread_id?: string | null
          updated_at?: string
          view_limit?: number | null
        }
        Update: {
          body_json?: Json
          client_nonce?: string | null
          content?: string
          created_at?: string
          deleted_at?: string | null
          expires_at?: string | null
          id?: string
          is_deleted?: boolean
          is_pinned?: boolean
          message_type?: string
          permissions?: Json
          pinned_at?: string | null
          pinned_by?: string | null
          read_at?: string | null
          reply_to_message_id?: string | null
          retention_policy?: string
          room_id?: string
          sender_id?: string | null
          sender_identity_id?: string | null
          sender_merchant_id?: string
          status?: string
          thread_id?: string | null
          updated_at?: string
          view_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "os_messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "os_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_room_summary_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "os_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      os_room_members: {
        Row: {
          created_at: string
          id: string
          joined_at: string
          merchant_id: string
          role: Database["public"]["Enums"]["os_chat_member_role"]
          room_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          joined_at?: string
          merchant_id: string
          role?: Database["public"]["Enums"]["os_chat_member_role"]
          room_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          joined_at?: string
          merchant_id?: string
          role?: Database["public"]["Enums"]["os_chat_member_role"]
          room_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "os_room_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_room_summary_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_room_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "os_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      os_room_presence: {
        Row: {
          id: string
          is_focused: boolean
          last_read_message_id: string | null
          last_seen_at: string
          merchant_id: string
          room_id: string
        }
        Insert: {
          id?: string
          is_focused?: boolean
          last_read_message_id?: string | null
          last_seen_at?: string
          merchant_id: string
          room_id: string
        }
        Update: {
          id?: string
          is_focused?: boolean
          last_read_message_id?: string | null
          last_seen_at?: string
          merchant_id?: string
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "os_room_presence_last_read_message_id_fkey"
            columns: ["last_read_message_id"]
            isOneToOne: false
            referencedRelation: "os_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_room_presence_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "chat_room_summary_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_room_presence_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "os_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      os_rooms: {
        Row: {
          avatar_url: string | null
          created_at: string
          description: string | null
          id: string
          lane: string
          last_message_at: string | null
          last_message_id: string | null
          metadata: Json
          name: string
          retention_policy: string
          security_policies: Json
          type: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          lane?: string
          last_message_at?: string | null
          last_message_id?: string | null
          metadata?: Json
          name: string
          retention_policy?: string
          security_policies?: Json
          type?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          lane?: string
          last_message_at?: string | null
          last_message_id?: string | null
          metadata?: Json
          name?: string
          retention_policy?: string
          security_policies?: Json
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      otc_disputes: {
        Row: {
          admin_mediator_id: string | null
          created_at: string
          evidence_urls: string[]
          id: string
          opened_by: string
          reason: string
          resolution: string | null
          resolution_note: string | null
          respondent_evidence_urls: string[]
          respondent_user_id: string
          status: string
          trade_id: string
          updated_at: string
        }
        Insert: {
          admin_mediator_id?: string | null
          created_at?: string
          evidence_urls?: string[]
          id?: string
          opened_by: string
          reason?: string
          resolution?: string | null
          resolution_note?: string | null
          respondent_evidence_urls?: string[]
          respondent_user_id: string
          status?: string
          trade_id: string
          updated_at?: string
        }
        Update: {
          admin_mediator_id?: string | null
          created_at?: string
          evidence_urls?: string[]
          id?: string
          opened_by?: string
          reason?: string
          resolution?: string | null
          resolution_note?: string | null
          respondent_evidence_urls?: string[]
          respondent_user_id?: string
          status?: string
          trade_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "otc_disputes_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "otc_trades"
            referencedColumns: ["id"]
          },
        ]
      }
      otc_escrow: {
        Row: {
          amount: number
          created_at: string
          currency: string
          deposited_at: string | null
          depositor_user_id: string
          id: string
          released_at: string | null
          side: string
          status: string
          trade_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          deposited_at?: string | null
          depositor_user_id: string
          id?: string
          released_at?: string | null
          side: string
          status?: string
          trade_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          deposited_at?: string | null
          depositor_user_id?: string
          id?: string
          released_at?: string | null
          side?: string
          status?: string
          trade_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "otc_escrow_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "otc_trades"
            referencedColumns: ["id"]
          },
        ]
      }
      otc_listings: {
        Row: {
          amount_max: number
          amount_min: number
          created_at: string
          currency: string
          expires_at: string | null
          id: string
          merchant_id: string
          note: string | null
          payment_methods: string[]
          rate: number
          side: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_max?: number
          amount_min?: number
          created_at?: string
          currency?: string
          expires_at?: string | null
          id?: string
          merchant_id: string
          note?: string | null
          payment_methods?: string[]
          rate?: number
          side: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_max?: number
          amount_min?: number
          created_at?: string
          currency?: string
          expires_at?: string | null
          id?: string
          merchant_id?: string
          note?: string | null
          payment_methods?: string[]
          rate?: number
          side?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      otc_reviews: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          rating: number
          reviewed_user_id: string
          reviewer_user_id: string
          trade_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          rating: number
          reviewed_user_id: string
          reviewer_user_id: string
          trade_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          rating?: number
          reviewed_user_id?: string
          reviewer_user_id?: string
          trade_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "otc_reviews_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "otc_trades"
            referencedColumns: ["id"]
          },
        ]
      }
      otc_trades: {
        Row: {
          amount: number
          cancelled_at: string | null
          chat_room_id: string | null
          completed_at: string | null
          confirmed_at: string | null
          counter_amount: number | null
          counter_note: string | null
          counter_rate: number | null
          counter_total: number | null
          created_at: string
          currency: string
          escrow_status: string
          id: string
          initiator_merchant_id: string
          initiator_user_id: string
          listing_id: string | null
          note: string | null
          rate: number
          responder_merchant_id: string
          responder_user_id: string
          side: string
          status: string
          total: number
          updated_at: string
        }
        Insert: {
          amount?: number
          cancelled_at?: string | null
          chat_room_id?: string | null
          completed_at?: string | null
          confirmed_at?: string | null
          counter_amount?: number | null
          counter_note?: string | null
          counter_rate?: number | null
          counter_total?: number | null
          created_at?: string
          currency?: string
          escrow_status?: string
          id?: string
          initiator_merchant_id: string
          initiator_user_id: string
          listing_id?: string | null
          note?: string | null
          rate?: number
          responder_merchant_id: string
          responder_user_id: string
          side: string
          status?: string
          total?: number
          updated_at?: string
        }
        Update: {
          amount?: number
          cancelled_at?: string | null
          chat_room_id?: string | null
          completed_at?: string | null
          confirmed_at?: string | null
          counter_amount?: number | null
          counter_note?: string | null
          counter_rate?: number | null
          counter_total?: number | null
          created_at?: string
          currency?: string
          escrow_status?: string
          id?: string
          initiator_merchant_id?: string
          initiator_user_id?: string
          listing_id?: string | null
          note?: string | null
          rate?: number
          responder_merchant_id?: string
          responder_user_id?: string
          side?: string
          status?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "otc_trades_chat_room_id_fkey"
            columns: ["chat_room_id"]
            isOneToOne: false
            referencedRelation: "chat_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "otc_trades_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "otc_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      p2p_snapshots: {
        Row: {
          data: Json
          fetched_at: string
          id: string
          market: string
        }
        Insert: {
          data: Json
          fetched_at?: string
          id?: string
          market: string
        }
        Update: {
          data?: Json
          fetched_at?: string
          id?: string
          market?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          rejection_reason: string | null
          role: string
          status: string
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          rejection_reason?: string | null
          role?: string
          status?: string
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          rejection_reason?: string | null
          role?: string
          status?: string
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      profit_records: {
        Row: {
          agreement_id: string | null
          amount: number
          created_at: string
          currency: string
          deal_id: string | null
          id: string
          merchant_id: string
          notes: string | null
          period_id: string | null
          recorded_by: string | null
          relationship_id: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          agreement_id?: string | null
          amount?: number
          created_at?: string
          currency?: string
          deal_id?: string | null
          id?: string
          merchant_id: string
          notes?: string | null
          period_id?: string | null
          recorded_by?: string | null
          relationship_id: string
          status?: string
          type?: string
          updated_at?: string
        }
        Update: {
          agreement_id?: string | null
          amount?: number
          created_at?: string
          currency?: string
          deal_id?: string | null
          id?: string
          merchant_id?: string
          notes?: string | null
          period_id?: string | null
          recorded_by?: string | null
          relationship_id?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      profit_share_agreements: {
        Row: {
          agreement_type: string
          approved_at: string | null
          approved_by: string | null
          counterparty_default_profit_handling: string
          created_at: string
          created_by: string
          effective_from: string
          expires_at: string | null
          id: string
          invested_capital: number | null
          lender_contribution: number | null
          merchant_ratio: number
          notes: string | null
          operator_contribution: number | null
          operator_default_profit_handling: string
          operator_merchant_id: string | null
          operator_ratio: number | null
          partner_ratio: number
          relationship_id: string
          settlement_cadence: string
          settlement_way: string | null
          status: string
          terms_snapshot: Json | null
          updated_at: string
        }
        Insert: {
          agreement_type?: string
          approved_at?: string | null
          approved_by?: string | null
          counterparty_default_profit_handling?: string
          created_at?: string
          created_by: string
          effective_from?: string
          expires_at?: string | null
          id?: string
          invested_capital?: number | null
          lender_contribution?: number | null
          merchant_ratio: number
          notes?: string | null
          operator_contribution?: number | null
          operator_default_profit_handling?: string
          operator_merchant_id?: string | null
          operator_ratio?: number | null
          partner_ratio: number
          relationship_id: string
          settlement_cadence?: string
          settlement_way?: string | null
          status?: string
          terms_snapshot?: Json | null
          updated_at?: string
        }
        Update: {
          agreement_type?: string
          approved_at?: string | null
          approved_by?: string | null
          counterparty_default_profit_handling?: string
          created_at?: string
          created_by?: string
          effective_from?: string
          expires_at?: string | null
          id?: string
          invested_capital?: number | null
          lender_contribution?: number | null
          merchant_ratio?: number
          notes?: string | null
          operator_contribution?: number | null
          operator_default_profit_handling?: string
          operator_merchant_id?: string | null
          operator_ratio?: number | null
          partner_ratio?: number
          relationship_id?: string
          settlement_cadence?: string
          settlement_way?: string | null
          status?: string
          terms_snapshot?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profit_share_agreements_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "merchant_relationships"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_decisions: {
        Row: {
          agreement_id: string
          created_at: string
          decision: string
          decision_confirmed_at: string | null
          decision_due_at: string | null
          default_behavior: string
          effective_capital_after: number
          effective_capital_before: number
          finalization_snapshot: Json | null
          finalized_at: string | null
          id: string
          merchant_id: string
          profit_amount: number
          reinvested_amount: number
          role: string
          settlement_period_id: string
          updated_at: string
          withdrawn_amount: number
        }
        Insert: {
          agreement_id: string
          created_at?: string
          decision?: string
          decision_confirmed_at?: string | null
          decision_due_at?: string | null
          default_behavior?: string
          effective_capital_after?: number
          effective_capital_before?: number
          finalization_snapshot?: Json | null
          finalized_at?: string | null
          id?: string
          merchant_id: string
          profit_amount?: number
          reinvested_amount?: number
          role?: string
          settlement_period_id: string
          updated_at?: string
          withdrawn_amount?: number
        }
        Update: {
          agreement_id?: string
          created_at?: string
          decision?: string
          decision_confirmed_at?: string | null
          decision_due_at?: string | null
          default_behavior?: string
          effective_capital_after?: number
          effective_capital_before?: number
          finalization_snapshot?: Json | null
          finalized_at?: string | null
          id?: string
          merchant_id?: string
          profit_amount?: number
          reinvested_amount?: number
          role?: string
          settlement_period_id?: string
          updated_at?: string
          withdrawn_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "settlement_decisions_agreement_id_fkey"
            columns: ["agreement_id"]
            isOneToOne: false
            referencedRelation: "profit_share_agreements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_decisions_settlement_period_id_fkey"
            columns: ["settlement_period_id"]
            isOneToOne: false
            referencedRelation: "settlement_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_overviews: {
        Row: {
          agreement_id: string | null
          created_at: string
          id: string
          period_label: string | null
          relationship_id: string
          status: string
          total_profit: number
          total_reinvested: number
          total_withdrawn: number
          updated_at: string
        }
        Insert: {
          agreement_id?: string | null
          created_at?: string
          id?: string
          period_label?: string | null
          relationship_id: string
          status?: string
          total_profit?: number
          total_reinvested?: number
          total_withdrawn?: number
          updated_at?: string
        }
        Update: {
          agreement_id?: string | null
          created_at?: string
          id?: string
          period_label?: string | null
          relationship_id?: string
          status?: string
          total_profit?: number
          total_reinvested?: number
          total_withdrawn?: number
          updated_at?: string
        }
        Relationships: []
      }
      settlement_periods: {
        Row: {
          cadence: string
          created_at: string
          deal_id: string
          due_at: string | null
          gross_volume: number
          id: string
          merchant_amount: number
          net_profit: number
          partner_amount: number
          period_end: string
          period_key: string
          period_start: string
          relationship_id: string
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          settled_amount: number
          settled_at: string | null
          settlement_id: string | null
          status: string
          total_cost: number
          total_fees: number
          trade_count: number
          updated_at: string
        }
        Insert: {
          cadence: string
          created_at?: string
          deal_id: string
          due_at?: string | null
          gross_volume?: number
          id?: string
          merchant_amount?: number
          net_profit?: number
          partner_amount?: number
          period_end: string
          period_key: string
          period_start: string
          relationship_id: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          settled_amount?: number
          settled_at?: string | null
          settlement_id?: string | null
          status?: string
          total_cost?: number
          total_fees?: number
          trade_count?: number
          updated_at?: string
        }
        Update: {
          cadence?: string
          created_at?: string
          deal_id?: string
          due_at?: string | null
          gross_volume?: number
          id?: string
          merchant_amount?: number
          net_profit?: number
          partner_amount?: number
          period_end?: string
          period_key?: string
          period_start?: string
          relationship_id?: string
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          settled_amount?: number
          settled_at?: string | null
          settlement_id?: string | null
          status?: string
          total_cost?: number
          total_fees?: number
          trade_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "settlement_periods_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "merchant_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_periods_relationship_id_fkey"
            columns: ["relationship_id"]
            isOneToOne: false
            referencedRelation: "merchant_relationships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settlement_periods_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "merchant_settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      tracker_snapshots: {
        Row: {
          created_at: string
          id: string
          is_cleared: boolean
          preferences: Json
          state: Json
          updated_at: string
          user_id: string
          write_generation: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_cleared?: boolean
          preferences?: Json
          state?: Json
          updated_at?: string
          user_id: string
          write_generation?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_cleared?: boolean
          preferences?: Json
          state?: Json
          updated_at?: string
          user_id?: string
          write_generation?: number
        }
        Relationships: []
      }
      tracker_states: {
        Row: {
          created_at: string
          id: string
          state: Json
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          state?: Json
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          state?: Json
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      chat_room_summary_v: {
        Row: {
          id: string | null
          lane: string | null
          last_message_at: string | null
          last_message_content: string | null
          last_message_sender: string | null
          message_count: number | null
          name: string | null
          retention_policy: string | null
          security_policies: Json | null
          type: string | null
        }
        Insert: {
          id?: string | null
          lane?: string | null
          last_message_at?: string | null
          last_message_content?: never
          last_message_sender?: never
          message_count?: never
          name?: string | null
          retention_policy?: string | null
          security_policies?: Json | null
          type?: string | null
        }
        Update: {
          id?: string | null
          lane?: string | null
          last_message_at?: string | null
          last_message_content?: never
          last_message_sender?: never
          message_count?: never
          name?: string | null
          retention_policy?: string | null
          security_policies?: Json | null
          type?: string | null
        }
        Relationships: []
      }
      parent_order_summary: {
        Row: {
          fill_count: number | null
          fulfilled_qar: number | null
          fulfillment_status: string | null
          parent_order_id: string | null
          parent_qar_amount: number | null
          progress_percent: number | null
          remaining_qar: number | null
          remaining_usdt: number | null
          required_usdt: number | null
          total_egp_received: number | null
          total_fulfilled_usdt: number | null
          usdt_qar_rate: number | null
          weighted_avg_fx: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_customer_order_request: {
        Args: { p_customer_cash_account_id: string; p_order_id: string }
        Returns: {
          amount: number
          approval_required_from_role: string | null
          approved_at: string | null
          approved_by_user_id: string | null
          confirmed_at: string | null
          connection_id: string
          corridor_label: string | null
          created_at: string
          currency: string
          customer_accepted_quote_at: string | null
          customer_rejected_quote_at: string | null
          customer_user_id: string
          destination_cash_account_id: string | null
          edited_from_order_id: string | null
          expires_at: string | null
          final_quote_expires_at: string | null
          final_quote_note: string | null
          final_rate: number | null
          final_total: number | null
          fulfillment_mode: string | null
          fx_rate: number | null
          guide_generated_at: string | null
          guide_rate: number | null
          guide_snapshot: Json | null
          guide_source: string | null
          guide_total: number | null
          id: string
          market_pair: string | null
          merchant_id: string
          mirror_error_reason: string | null
          mirror_status: string | null
          note: string | null
          order_type: string
          payment_proof_uploaded_at: string | null
          payment_proof_url: string | null
          payout_rail: string | null
          placed_by_role: string | null
          placed_by_user_id: string | null
          pricing_mode: string | null
          pricing_version: string | null
          quote_rejection_reason: string | null
          quoted_at: string | null
          quoted_by_user_id: string | null
          rate: number | null
          receive_country: string | null
          receive_currency: string | null
          rejected_at: string | null
          rejected_by_user_id: string | null
          rejection_reason: string | null
          required_usdt: number | null
          revision_no: number
          send_country: string | null
          send_currency: string | null
          status: string
          total: number | null
          updated_at: string
          usdt_qar_rate: number | null
          workflow_status: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customer_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_broadcast_notification: {
        Args: { _body: string; _category?: string; _title: string }
        Returns: number
      }
      admin_correct_deal: {
        Args: { _deal_id: string; _reason: string; _updates: Json }
        Returns: Json
      }
      admin_correct_tracker: {
        Args: {
          _entity_id: string
          _entity_type: string
          _reason: string
          _target_user_id: string
          _updates: Json
        }
        Returns: undefined
      }
      admin_get_user_workspace: {
        Args: { _target_user_id: string }
        Returns: Json
      }
      admin_system_stats: { Args: never; Returns: Json }
      admin_void_deal: {
        Args: { _deal_id: string; _reason: string }
        Returns: undefined
      }
      admin_void_tracker_entity: {
        Args: {
          _entity_id: string
          _entity_type: string
          _reason: string
          _target_user_id: string
        }
        Returns: undefined
      }
      approve_settlement: {
        Args: { _settlement_id: string }
        Returns: undefined
      }
      chat_active_merchant_id: { Args: { p_user_id?: string }; Returns: string }
      chat_add_reaction: {
        Args: { _emoji: string; _message_id: string }
        Returns: undefined
      }
      chat_answer_call: {
        Args: { _call_id: string; _sdp_answer: string }
        Returns: undefined
      }
      chat_can_view_presence: {
        Args: { _subject: string; _viewer?: string }
        Returns: boolean
      }
      chat_cancel_market_offer: {
        Args: { _offer_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          currency_pair: string
          expires_at: string | null
          id: string
          max_amount: number
          merchant_id: string
          min_amount: number
          note: string | null
          offer_type: string
          rate: number
          room_id: string
          status: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "market_offers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_create_attachment:
        | {
            Args: {
              _auth_tag?: string
              _cdn_url?: string
              _checksum_sha256?: string
              _duration_ms?: number
              _file_name: string
              _file_size: number
              _height?: number
              _is_encrypted?: boolean
              _iv?: string
              _message_id: string
              _mime_type: string
              _room_id: string
              _storage_path: string
              _thumbnail_path?: string
              _waveform?: Json
              _width?: number
            }
            Returns: string
          }
        | {
            Args: {
              _auth_tag?: string
              _cdn_url?: string
              _checksum_sha256?: string
              _duration_ms?: number
              _file_name: string
              _file_size: number
              _height?: number
              _is_encrypted?: boolean
              _iv?: string
              _mime_type: string
              _room_id: string
              _storage_path: string
              _thumbnail_path?: string
              _waveform?: Json
              _width?: number
            }
            Returns: {
              auth_tag: string | null
              cdn_url: string | null
              checksum_sha256: string | null
              created_at: string
              duration_ms: number | null
              file_name: string
              file_size: number
              height: number | null
              id: string
              is_encrypted: boolean
              is_validated: boolean
              iv: string | null
              message_id: string | null
              mime_type: string
              room_id: string
              storage_path: string
              thumbnail_path: string | null
              uploader_id: string
              waveform: Json | null
              width: number | null
            }
            SetofOptions: {
              from: "*"
              to: "chat_attachments"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      chat_create_market_offer:
        | {
            Args: {
              _currency_pair?: string
              _expires_at?: string
              _max_amount?: number
              _min_amount?: number
              _note?: string
              _offer_type: string
              _rate: number
            }
            Returns: string
          }
        | {
            Args: {
              _amount: number
              _expires_at?: string
              _max_amount?: number
              _min_amount?: number
              _notes?: string
              _offer_type: Database["public"]["Enums"]["market_offer_type"]
              _payment_methods?: string[]
              _price: number
              _room_id: string
            }
            Returns: {
              created_at: string
              created_by: string | null
              currency_pair: string
              expires_at: string | null
              id: string
              max_amount: number
              merchant_id: string
              min_amount: number
              note: string | null
              offer_type: string
              rate: number
              room_id: string
              status: string
              updated_at: string
              user_id: string
            }
            SetofOptions: {
              from: "*"
              to: "market_offers"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      chat_create_merchant_client_room: {
        Args: { _customer_user_id: string; _room_name?: string }
        Returns: string
      }
      chat_delete_message: {
        Args: { _for_everyone?: boolean; _message_id: string }
        Returns: undefined
      }
      chat_edit_message: {
        Args: { _message_id: string; _new_content: string }
        Returns: {
          client_nonce: string | null
          content: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_for_sender: boolean
          edited_at: string | null
          expires_at: string | null
          forwarded_from_id: string | null
          id: string
          is_deleted: boolean
          is_edited: boolean
          metadata: Json
          reply_to_id: string | null
          room_id: string
          search_vector: unknown
          sender_id: string
          type: Database["public"]["Enums"]["chat_message_type"]
          updated_at: string
          view_once: boolean
          viewed_by: string[]
          watermark_text: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      chat_end_call: {
        Args: {
          _call_id: string
          _end_reason?: string
          _signaling_channel?: string
        }
        Returns: undefined
      }
      chat_ensure_qatar_market_room: { Args: never; Returns: string }
      chat_export_room_transcript: {
        Args: { _room_id: string }
        Returns: {
          content: string
          created_at: string
          message_id: string
          metadata: Json
          room_id: string
          sender_id: string
          sender_name: string
          type: Database["public"]["Enums"]["chat_message_type"]
        }[]
      }
      chat_forward_message: {
        Args: {
          _client_nonce?: string
          _message_id: string
          _target_room_id: string
        }
        Returns: {
          client_nonce: string | null
          content: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_for_sender: boolean
          edited_at: string | null
          expires_at: string | null
          forwarded_from_id: string | null
          id: string
          is_deleted: boolean
          is_edited: boolean
          metadata: Json
          reply_to_id: string | null
          room_id: string
          search_vector: unknown
          sender_id: string
          type: Database["public"]["Enums"]["chat_message_type"]
          updated_at: string
          view_once: boolean
          viewed_by: string[]
          watermark_text: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_get_or_create_collab_room: {
        Args: { _name?: string }
        Returns: string
      }
      chat_get_or_create_direct_room: {
        Args: { _other_user_id: string; _room_name?: string }
        Returns: string
      }
      chat_get_privacy_settings: { Args: never; Returns: Json }
      chat_get_qatar_market_room: { Args: never; Returns: string }
      chat_get_room_members: {
        Args: { _room_id: string }
        Returns: {
          avatar_url: string
          display_name: string
          display_name_override: string
          id: string
          invited_by: string
          is_archived: boolean
          is_muted: boolean
          is_pinned: boolean
          joined_at: string
          last_read_at: string
          last_read_message_id: string
          muted_until: string
          notification_level: string
          removed_at: string
          role: Database["public"]["Enums"]["chat_member_role"]
          room_id: string
          user_id: string
        }[]
      }
      chat_get_rooms: {
        Args: never
        Returns: {
          avatar_url: string
          is_archived: boolean
          is_direct: boolean
          is_muted: boolean
          is_pinned: boolean
          last_message_at: string
          last_message_preview: string
          member_count: number
          name: string
          other_user_id: string
          other_user_metadata: Json
          room_id: string
          room_type: Database["public"]["Enums"]["chat_room_type"]
          unread_count: number
        }[]
      }
      chat_get_rooms_v2: {
        Args: never
        Returns: {
          avatar_url: string
          is_archived: boolean
          is_direct: boolean
          is_muted: boolean
          is_pinned: boolean
          last_message_at: string
          last_message_preview: string
          member_count: number
          name: string
          other_user_id: string
          other_user_metadata: Json
          policy: Json
          room_id: string
          room_type: Database["public"]["Enums"]["chat_room_type"]
          unread_count: number
        }[]
      }
      chat_initiate_call: {
        Args: { _call_id?: string; _ice_config?: Json; _room_id: string }
        Returns: string
      }
      chat_is_allowed_mime: {
        Args: { _allowed_mime_types: string[]; _mime_type: string }
        Returns: boolean
      }
      chat_link_attachment_to_message: {
        Args: { _attachment_id: string; _message_id: string }
        Returns: {
          auth_tag: string | null
          cdn_url: string | null
          checksum_sha256: string | null
          created_at: string
          duration_ms: number | null
          file_name: string
          file_size: number
          height: number | null
          id: string
          is_encrypted: boolean
          is_validated: boolean
          iv: string | null
          message_id: string | null
          mime_type: string
          room_id: string
          storage_path: string
          thumbnail_path: string | null
          uploader_id: string
          waveform: Json | null
          width: number | null
        }
        SetofOptions: {
          from: "*"
          to: "chat_attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      chat_mark_room_read: {
        Args: { _room_id: string; _up_to_message_id?: string }
        Returns: undefined
      }
      chat_mark_viewed: { Args: { _message_id: string }; Returns: undefined }
      chat_push_ice_candidate: {
        Args: { _call_id: string; _candidate: Json }
        Returns: undefined
      }
      chat_remove_reaction: {
        Args: { _emoji: string; _message_id: string }
        Returns: undefined
      }
      chat_run_expiry_cleanup: { Args: never; Returns: Json }
      chat_search_messages: {
        Args: { _limit?: number; _query: string; _room_id: string }
        Returns: {
          client_nonce: string | null
          content: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_for_sender: boolean
          edited_at: string | null
          expires_at: string | null
          forwarded_from_id: string | null
          id: string
          is_deleted: boolean
          is_edited: boolean
          metadata: Json
          reply_to_id: string | null
          room_id: string
          search_vector: unknown
          sender_id: string
          type: Database["public"]["Enums"]["chat_message_type"]
          updated_at: string
          view_once: boolean
          viewed_by: string[]
          watermark_text: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      chat_send_message: {
        Args: {
          _attachment_id?: string
          _client_nonce?: string
          _content: string
          _expires_at?: string
          _metadata?: Json
          _reply_to_id?: string
          _room_id: string
          _type?: Database["public"]["Enums"]["chat_message_type"]
          _view_once?: boolean
          _watermark_text?: string
        }
        Returns: {
          client_nonce: string | null
          content: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_for_sender: boolean
          edited_at: string | null
          expires_at: string | null
          forwarded_from_id: string | null
          id: string
          is_deleted: boolean
          is_edited: boolean
          metadata: Json
          reply_to_id: string | null
          room_id: string
          search_vector: unknown
          sender_id: string
          type: Database["public"]["Enums"]["chat_message_type"]
          updated_at: string
          view_once: boolean
          viewed_by: string[]
          watermark_text: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "chat_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      chat_set_presence: {
        Args: { _device_info?: Json; _status?: string }
        Returns: undefined
      }
      chat_set_typing: {
        Args: { _is_typing: boolean; _room_id: string }
        Returns: undefined
      }
      chat_sync_qatar_market_room_members: { Args: never; Returns: string }
      chat_update_privacy_settings:
        | {
            Args: {
              _anonymous_mode?: boolean
              _copy_disabled?: boolean
              _export_disabled?: boolean
              _forwarding_disabled?: boolean
              _hide_last_seen?: boolean
              _hide_read_receipts?: boolean
              _hide_typing?: boolean
              _invisible_mode?: boolean
              _notification_preview?: string
              _online_visibility?: string
              _screenshot_protection?: boolean
              _show_sender_in_notification?: boolean
              _watermark_enabled?: boolean
            }
            Returns: Json
          }
        | {
            Args: {
              _hide_last_seen?: boolean
              _hide_read_receipts?: boolean
              _hide_typing?: boolean
              _invisible_mode?: boolean
              _online_visibility?: string
            }
            Returns: Json
          }
      chat_update_room_policy: {
        Args: { _room_id: string; _updates: Json }
        Returns: Json
      }
      chat_users_share_room: {
        Args: { _user_a: string; _user_b: string }
        Returns: boolean
      }
      create_customer_order_request: {
        Args: {
          p_amount: number
          p_connection_id: string
          p_customer_cash_account_id?: string
          p_fulfillment_mode?: string
          p_fx_rate?: number
          p_merchant_cash_account_id?: string
          p_note?: string
          p_order_type: string
          p_payout_rail: string
          p_placed_by_role: string
          p_receive_country: string
          p_receive_currency: string
          p_send_country: string
          p_send_currency: string
          p_usdt_qar_rate?: number
        }
        Returns: {
          amount: number
          approval_required_from_role: string | null
          approved_at: string | null
          approved_by_user_id: string | null
          confirmed_at: string | null
          connection_id: string
          corridor_label: string | null
          created_at: string
          currency: string
          customer_accepted_quote_at: string | null
          customer_rejected_quote_at: string | null
          customer_user_id: string
          destination_cash_account_id: string | null
          edited_from_order_id: string | null
          expires_at: string | null
          final_quote_expires_at: string | null
          final_quote_note: string | null
          final_rate: number | null
          final_total: number | null
          fulfillment_mode: string | null
          fx_rate: number | null
          guide_generated_at: string | null
          guide_rate: number | null
          guide_snapshot: Json | null
          guide_source: string | null
          guide_total: number | null
          id: string
          market_pair: string | null
          merchant_id: string
          mirror_error_reason: string | null
          mirror_status: string | null
          note: string | null
          order_type: string
          payment_proof_uploaded_at: string | null
          payment_proof_url: string | null
          payout_rail: string | null
          placed_by_role: string | null
          placed_by_user_id: string | null
          pricing_mode: string | null
          pricing_version: string | null
          quote_rejection_reason: string | null
          quoted_at: string | null
          quoted_by_user_id: string | null
          rate: number | null
          receive_country: string | null
          receive_currency: string | null
          rejected_at: string | null
          rejected_by_user_id: string | null
          rejection_reason: string | null
          required_usdt: number | null
          revision_no: number
          send_country: string | null
          send_currency: string | null
          status: string
          total: number | null
          updated_at: string
          usdt_qar_rate: number | null
          workflow_status: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customer_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_merchant_id: { Args: never; Returns: string }
      customer_settlement_summary: {
        Args: { p_user_id: string }
        Returns: Json
      }
      customer_wallet_summary: { Args: { p_user_id: string }; Returns: Json }
      deal_reinvested_pool: { Args: { _deal_id: string }; Returns: number }
      edit_customer_order_request:
        | {
            Args: {
              p_actor_role: string
              p_amount?: number
              p_customer_cash_account_id?: string
              p_fx_rate?: number
              p_merchant_cash_account_id?: string
              p_note?: string
              p_order_id: string
            }
            Returns: {
              amount: number
              approval_required_from_role: string | null
              approved_at: string | null
              approved_by_user_id: string | null
              confirmed_at: string | null
              connection_id: string
              corridor_label: string | null
              created_at: string
              currency: string
              customer_accepted_quote_at: string | null
              customer_rejected_quote_at: string | null
              customer_user_id: string
              destination_cash_account_id: string | null
              edited_from_order_id: string | null
              expires_at: string | null
              final_quote_expires_at: string | null
              final_quote_note: string | null
              final_rate: number | null
              final_total: number | null
              fulfillment_mode: string | null
              fx_rate: number | null
              guide_generated_at: string | null
              guide_rate: number | null
              guide_snapshot: Json | null
              guide_source: string | null
              guide_total: number | null
              id: string
              market_pair: string | null
              merchant_id: string
              mirror_error_reason: string | null
              mirror_status: string | null
              note: string | null
              order_type: string
              payment_proof_uploaded_at: string | null
              payment_proof_url: string | null
              payout_rail: string | null
              placed_by_role: string | null
              placed_by_user_id: string | null
              pricing_mode: string | null
              pricing_version: string | null
              quote_rejection_reason: string | null
              quoted_at: string | null
              quoted_by_user_id: string | null
              rate: number | null
              receive_country: string | null
              receive_currency: string | null
              rejected_at: string | null
              rejected_by_user_id: string | null
              rejection_reason: string | null
              required_usdt: number | null
              revision_no: number
              send_country: string | null
              send_currency: string | null
              status: string
              total: number | null
              updated_at: string
              usdt_qar_rate: number | null
              workflow_status: string | null
            }
            SetofOptions: {
              from: "*"
              to: "customer_orders"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_actor_role: string
              p_amount?: number
              p_customer_cash_account_id?: string
              p_merchant_cash_account_id?: string
              p_note?: string
              p_order_id: string
            }
            Returns: {
              amount: number
              approval_required_from_role: string | null
              approved_at: string | null
              approved_by_user_id: string | null
              confirmed_at: string | null
              connection_id: string
              corridor_label: string | null
              created_at: string
              currency: string
              customer_accepted_quote_at: string | null
              customer_rejected_quote_at: string | null
              customer_user_id: string
              destination_cash_account_id: string | null
              edited_from_order_id: string | null
              expires_at: string | null
              final_quote_expires_at: string | null
              final_quote_note: string | null
              final_rate: number | null
              final_total: number | null
              fulfillment_mode: string | null
              fx_rate: number | null
              guide_generated_at: string | null
              guide_rate: number | null
              guide_snapshot: Json | null
              guide_source: string | null
              guide_total: number | null
              id: string
              market_pair: string | null
              merchant_id: string
              mirror_error_reason: string | null
              mirror_status: string | null
              note: string | null
              order_type: string
              payment_proof_uploaded_at: string | null
              payment_proof_url: string | null
              payout_rail: string | null
              placed_by_role: string | null
              placed_by_user_id: string | null
              pricing_mode: string | null
              pricing_version: string | null
              quote_rejection_reason: string | null
              quoted_at: string | null
              quoted_by_user_id: string | null
              rate: number | null
              receive_country: string | null
              receive_currency: string | null
              rejected_at: string | null
              rejected_by_user_id: string | null
              rejection_reason: string | null
              required_usdt: number | null
              revision_no: number
              send_country: string | null
              send_currency: string | null
              status: string
              total: number | null
              updated_at: string
              usdt_qar_rate: number | null
              workflow_status: string | null
            }
            SetofOptions: {
              from: "*"
              to: "customer_orders"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      fn_chat_add_reaction: {
        Args: { _message_id: string; _reaction: string; _room_id: string }
        Returns: boolean
      }
      fn_chat_delete_message: {
        Args: { p_message_id: string; p_room_id: string }
        Returns: undefined
      }
      fn_chat_get_or_create_direct_room: {
        Args: { _counterparty_merchant_id: string; _room_title?: string }
        Returns: string
      }
      fn_chat_mark_read: {
        Args: { _message_id: string; _room_id: string }
        Returns: boolean
      }
      fn_chat_member_role: {
        Args: { p_room_id: string; p_user_id: string }
        Returns: Database["public"]["Enums"]["chat_member_role"]
      }
      fn_chat_pin_message: {
        Args: { p_message_id: string; p_room_id: string }
        Returns: undefined
      }
      fn_chat_remove_reaction: {
        Args: { _message_id: string; _reaction: string; _room_id: string }
        Returns: boolean
      }
      fn_chat_send_message: {
        Args: {
          _body: string
          _body_json?: Json
          _client_nonce?: string
          _expires_at?: string
          _message_type?: string
          _reply_to_message_id?: string
          _room_id: string
        }
        Returns: Json
      }
      fn_chat_unpin_message: {
        Args: { p_message_id: string; p_room_id: string }
        Returns: undefined
      }
      fn_finalize_settlement_decisions: {
        Args: {
          p_agreement_id: string
          p_agreement_snapshot: Json
          p_period_id: string
        }
        Returns: undefined
      }
      fn_get_dashboard_stats: { Args: { p_merchant_id: string }; Returns: Json }
      fn_get_user_privacy: {
        Args: { p_user_id: string }
        Returns: {
          anonymous_mode: boolean
          copy_disabled: boolean
          created_at: string
          export_disabled: boolean
          forwarding_disabled: boolean
          hide_last_seen: boolean
          hide_read_receipts: boolean
          hide_typing: boolean
          invisible_mode: boolean
          notification_preview: string
          online_visibility: string
          screenshot_protection: boolean
          show_sender_in_notification: boolean
          updated_at: string
          user_id: string
          watermark_enabled: boolean
        }
        SetofOptions: {
          from: "*"
          to: "chat_privacy_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fn_is_chat_member: {
        Args: { p_room_id: string; p_user_id: string }
        Returns: boolean
      }
      fn_is_presence_visible: {
        Args: { _target_user_id: string; _viewer_id: string }
        Returns: boolean
      }
      fn_otc_lifecycle_cleanup: { Args: never; Returns: undefined }
      get_fx_rate: {
        Args: { p_source_currency: string; p_target_currency: string }
        Returns: {
          fetched_at: string
          is_estimate: boolean
          rate: number
        }[]
      }
      get_merchant_cash_accounts: {
        Args: { p_merchant_id: string }
        Returns: {
          created_at: string
          currency: string
          id: string
          name: string
          status: string
          type: string
          updated_at: string
          user_id: string
        }[]
      }
      get_unread_counts: {
        Args: { _user_id?: string }
        Returns: {
          relationship_id: string
          unread_count: number
        }[]
      }
      has_relationship_with: {
        Args: { _target_merchant_id: string; _viewer_merchant_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      insert_order_execution:
        | {
            Args: {
              p_cash_account_id?: string
              p_egp_per_usdt: number
              p_executed_egp: number
              p_fx_rate_qar_to_egp?: number
              p_market_type?: string
              p_parent_order_id: string
              p_sold_qar_amount?: number
            }
            Returns: {
              cash_account_id: string | null
              created_at: string
              created_by: string
              egp_per_usdt: number | null
              egp_received_amount: number | null
              executed_at: string
              executed_egp: number | null
              fx_rate_qar_to_egp: number
              id: string
              market_type: string
              parent_order_id: string
              phase_consumed_qar: number | null
              phase_qar_egp_fx: number | null
              phase_usdt: number | null
              sequence_number: number
              sold_qar_amount: number
              status: string
              updated_at: string
            }
            SetofOptions: {
              from: "*"
              to: "order_executions"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_cash_account_id?: string
              p_fx_rate_qar_to_egp: number
              p_market_type?: string
              p_parent_order_id: string
              p_sold_qar_amount: number
            }
            Returns: {
              cash_account_id: string | null
              created_at: string
              created_by: string
              egp_per_usdt: number | null
              egp_received_amount: number | null
              executed_at: string
              executed_egp: number | null
              fx_rate_qar_to_egp: number
              id: string
              market_type: string
              parent_order_id: string
              phase_consumed_qar: number | null
              phase_qar_egp_fx: number | null
              phase_usdt: number | null
              sequence_number: number
              sold_qar_amount: number
              status: string
              updated_at: string
            }
            SetofOptions: {
              from: "*"
              to: "order_executions"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      is_customer_connection_member: {
        Args: { _connection_id: string }
        Returns: boolean
      }
      is_os_room_member: { Args: { _room_id: string }; Returns: boolean }
      is_relationship_member: {
        Args: { _relationship_id: string }
        Returns: boolean
      }
      localize_currency: { Args: { currency_code: string }; Returns: string }
      mark_conversation_read: {
        Args: { _relationship_id: string }
        Returns: undefined
      }
      merchant_trust_metrics: {
        Args: { p_customer_user_id: string; p_merchant_id: string }
        Returns: Json
      }
      mirror_merchant_customer_order: {
        Args: {
          p_amount?: number
          p_connection_id: string
          p_corridor_label?: string
          p_currency?: string
          p_customer_accepted_quote_at?: string
          p_customer_rejected_quote_at?: string
          p_final_quote_note?: string
          p_final_rate?: number
          p_final_total?: number
          p_guide_generated_at?: string
          p_guide_rate?: number
          p_guide_snapshot?: Json
          p_guide_source?: string
          p_guide_total?: number
          p_market_pair?: string
          p_note?: string
          p_order_type?: string
          p_payout_rail?: string
          p_pricing_mode?: string
          p_pricing_version?: string
          p_quote_rejection_reason?: string
          p_quoted_by_user_id?: string
          p_rate?: number
          p_receive_country?: string
          p_receive_currency?: string
          p_send_country?: string
          p_send_currency?: string
          p_status?: string
          p_total?: number
        }
        Returns: {
          amount: number
          approval_required_from_role: string | null
          approved_at: string | null
          approved_by_user_id: string | null
          confirmed_at: string | null
          connection_id: string
          corridor_label: string | null
          created_at: string
          currency: string
          customer_accepted_quote_at: string | null
          customer_rejected_quote_at: string | null
          customer_user_id: string
          destination_cash_account_id: string | null
          edited_from_order_id: string | null
          expires_at: string | null
          final_quote_expires_at: string | null
          final_quote_note: string | null
          final_rate: number | null
          final_total: number | null
          fulfillment_mode: string | null
          fx_rate: number | null
          guide_generated_at: string | null
          guide_rate: number | null
          guide_snapshot: Json | null
          guide_source: string | null
          guide_total: number | null
          id: string
          market_pair: string | null
          merchant_id: string
          mirror_error_reason: string | null
          mirror_status: string | null
          note: string | null
          order_type: string
          payment_proof_uploaded_at: string | null
          payment_proof_url: string | null
          payout_rail: string | null
          placed_by_role: string | null
          placed_by_user_id: string | null
          pricing_mode: string | null
          pricing_version: string | null
          quote_rejection_reason: string | null
          quoted_at: string | null
          quoted_by_user_id: string | null
          rate: number | null
          receive_country: string | null
          receive_currency: string | null
          rejected_at: string | null
          rejected_by_user_id: string | null
          rejection_reason: string | null
          required_usdt: number | null
          revision_no: number
          send_country: string | null
          send_currency: string | null
          status: string
          total: number | null
          updated_at: string
          usdt_qar_rate: number | null
          workflow_status: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customer_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      os_send_notification: {
        Args: { _message_id: string; _room_id: string; _urgency?: string }
        Returns: number
      }
      record_app_usage_session: {
        Args: {
          p_app_version?: string
          p_last_seen_at?: string
          p_platform?: string
          p_session_id: string
          p_user_id: string
        }
        Returns: undefined
      }
      reject_settlement: {
        Args: { _actor_id: string; _settlement_id: string }
        Returns: undefined
      }
      respond_customer_order_request: {
        Args: {
          p_action: string
          p_actor_role: string
          p_order_id: string
          p_reason?: string
        }
        Returns: {
          amount: number
          approval_required_from_role: string | null
          approved_at: string | null
          approved_by_user_id: string | null
          confirmed_at: string | null
          connection_id: string
          corridor_label: string | null
          created_at: string
          currency: string
          customer_accepted_quote_at: string | null
          customer_rejected_quote_at: string | null
          customer_user_id: string
          destination_cash_account_id: string | null
          edited_from_order_id: string | null
          expires_at: string | null
          final_quote_expires_at: string | null
          final_quote_note: string | null
          final_rate: number | null
          final_total: number | null
          fulfillment_mode: string | null
          fx_rate: number | null
          guide_generated_at: string | null
          guide_rate: number | null
          guide_snapshot: Json | null
          guide_source: string | null
          guide_total: number | null
          id: string
          market_pair: string | null
          merchant_id: string
          mirror_error_reason: string | null
          mirror_status: string | null
          note: string | null
          order_type: string
          payment_proof_uploaded_at: string | null
          payment_proof_url: string | null
          payout_rail: string | null
          placed_by_role: string | null
          placed_by_user_id: string | null
          pricing_mode: string | null
          pricing_version: string | null
          quote_rejection_reason: string | null
          quoted_at: string | null
          quoted_by_user_id: string | null
          rate: number | null
          receive_country: string | null
          receive_currency: string | null
          rejected_at: string | null
          rejected_by_user_id: string | null
          rejection_reason: string | null
          required_usdt: number | null
          revision_no: number
          send_country: string | null
          send_currency: string | null
          status: string
          total: number | null
          updated_at: string
          usdt_qar_rate: number | null
          workflow_status: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customer_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_tracker_snapshot_if_newer: {
        Args: {
          _is_cleared?: boolean
          _state: Json
          _updated_at: string
          _user_id: string
          _write_generation: number
        }
        Returns: boolean
      }
      set_merchant_deal_status: {
        Args: { _deal_id: string; _status: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      update_fx_rate: {
        Args: {
          p_rate: number
          p_source_currency: string
          p_target_currency: string
        }
        Returns: {
          fetched_at: string
          rate: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      chat_call_status:
        | "ringing"
        | "active"
        | "ended"
        | "missed"
        | "declined"
        | "failed"
        | "no_answer"
      chat_encryption_mode: "none" | "tls_only" | "server_e2ee" | "client_e2ee"
      chat_member_role: "owner" | "admin" | "member" | "guest"
      chat_message_type:
        | "text"
        | "voice_note"
        | "image"
        | "file"
        | "system"
        | "call_summary"
        | "order_card"
        | "payment_card"
        | "reaction_burst"
        | "market_offer"
      chat_room_type: "merchant_private" | "merchant_client" | "merchant_collab"
      market_offer_status: "active" | "filled" | "cancelled" | "expired"
      market_offer_type: "buy" | "sell"
      os_chat_member_role: "owner" | "admin" | "member"
      os_chat_message_type:
        | "text"
        | "voice"
        | "image"
        | "file"
        | "system"
        | "ai_summary"
        | "app_output"
      os_chat_room_type: "standard" | "deal" | "incident"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      chat_call_status: [
        "ringing",
        "active",
        "ended",
        "missed",
        "declined",
        "failed",
        "no_answer",
      ],
      chat_encryption_mode: ["none", "tls_only", "server_e2ee", "client_e2ee"],
      chat_member_role: ["owner", "admin", "member", "guest"],
      chat_message_type: [
        "text",
        "voice_note",
        "image",
        "file",
        "system",
        "call_summary",
        "order_card",
        "payment_card",
        "reaction_burst",
        "market_offer",
      ],
      chat_room_type: [
        "merchant_private",
        "merchant_client",
        "merchant_collab",
      ],
      market_offer_status: ["active", "filled", "cancelled", "expired"],
      market_offer_type: ["buy", "sell"],
      os_chat_member_role: ["owner", "admin", "member"],
      os_chat_message_type: [
        "text",
        "voice",
        "image",
        "file",
        "system",
        "ai_summary",
        "app_output",
      ],
      os_chat_room_type: ["standard", "deal", "incident"],
    },
  },
} as const
