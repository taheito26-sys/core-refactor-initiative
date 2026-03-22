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
          relationship_id: string
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
          relationship_id: string
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
          relationship_id?: string
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
          id: string
          read_at: string | null
          relationship_id: string
          sender_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          read_at?: string | null
          relationship_id: string
          sender_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          read_at?: string | null
          relationship_id?: string
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
        ]
      }
      merchant_profiles: {
        Row: {
          bio: string | null
          created_at: string
          default_currency: string
          display_name: string
          id: string
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
          display_name: string
          id?: string
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
          display_name?: string
          id?: string
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
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          deal_id: string
          id?: string
          notes?: string | null
          recorded_by: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          deal_id?: string
          id?: string
          notes?: string | null
          recorded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_profits_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "merchant_deals"
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
          settled_by: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          deal_id: string
          id?: string
          notes?: string | null
          settled_by: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          deal_id?: string
          id?: string
          notes?: string | null
          settled_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_settlements_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "merchant_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          category: string
          created_at: string
          id: string
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          category?: string
          created_at?: string
          id?: string
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          category?: string
          created_at?: string
          id?: string
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
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
      current_merchant_id: { Args: never; Returns: string }
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
