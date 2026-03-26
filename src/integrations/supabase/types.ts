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
    PostgrestVersion: "14.4"
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
      cash_accounts: {
        Row: {
          bank_name: string | null
          branch: string | null
          created_at: number
          currency: string
          id: string
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
          created_at: number
          currency: string
          id: string
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
      cash_ledger: {
        Row: {
          account_id: string
          amount: number
          contra_account_id: string | null
          created_at: string
          currency: string
          direction: string
          id: string
          linked_entity_id: string | null
          linked_entity_type: string | null
          note: string | null
          ts: number
          type: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount?: number
          contra_account_id?: string | null
          created_at?: string
          currency: string
          direction: string
          id: string
          linked_entity_id?: string | null
          linked_entity_type?: string | null
          note?: string | null
          ts: number
          type: string
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          contra_account_id?: string | null
          created_at?: string
          currency?: string
          direction?: string
          id?: string
          linked_entity_id?: string | null
          linked_entity_type?: string | null
          note?: string | null
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
        ]
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
      deal_capital_ledger: {
        Row: {
          amount: number
          created_at: string
          currency: string
          deal_id: string
          id: string
          initiated_by: string
          note: string | null
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
          bio: string | null
          created_at: string
          default_currency: string
          discoverability: string
          display_name: string
          id: string
          merchant_code: string | null
          merchant_id: string
          nickname: string
          region: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bio?: string | null
          created_at?: string
          default_currency?: string
          discoverability?: string
          display_name: string
          id?: string
          merchant_code?: string | null
          merchant_id: string
          nickname: string
          region?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bio?: string | null
          created_at?: string
          default_currency?: string
          discoverability?: string
          display_name?: string
          id?: string
          merchant_code?: string | null
          merchant_id?: string
          nickname?: string
          region?: string | null
          status?: string
          updated_at?: string
          user_id?: string
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
      notifications: {
        Row: {
          anchor_id: string | null
          body: string | null
          category: string
          conversation_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          message_id: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          anchor_id?: string | null
          body?: string | null
          category?: string
          conversation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message_id?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          anchor_id?: string | null
          body?: string | null
          category?: string
          conversation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message_id?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "merchant_relationships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "merchant_messages"
            referencedColumns: ["id"]
          },
        ]
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
          created_at: string
          email: string
          id: string
          rejection_reason: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          email: string
          id?: string
          rejection_reason?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          email?: string
          id?: string
          rejection_reason?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profit_share_agreements: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string
          effective_from: string
          expires_at: string | null
          id: string
          merchant_ratio: number
          notes: string | null
          partner_ratio: number
          relationship_id: string
          settlement_cadence: string
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by: string
          effective_from?: string
          expires_at?: string | null
          id?: string
          merchant_ratio: number
          notes?: string | null
          partner_ratio: number
          relationship_id: string
          settlement_cadence?: string
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string
          effective_from?: string
          expires_at?: string | null
          id?: string
          merchant_ratio?: number
          notes?: string | null
          partner_ratio?: number
          relationship_id?: string
          settlement_cadence?: string
          status?: string
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
          preferences: Json
          state: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          preferences?: Json
          state?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          preferences?: Json
          state?: Json
          updated_at?: string
          user_id?: string
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
      [_ in never]: never
    }
    Functions: {
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
      current_merchant_id: { Args: never; Returns: string }
      deal_reinvested_pool: { Args: { _deal_id: string }; Returns: number }
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
      is_relationship_member: {
        Args: { _relationship_id: string }
        Returns: boolean
      }
      mark_conversation_read: {
        Args: { _relationship_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
