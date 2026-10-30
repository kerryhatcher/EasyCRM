export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      contact_organization_relationships: {
        Row: {
          contact_id: string;
          contact_relationship: string;
          created_at: string;
          id: string;
          notes: string | null;
          organization_id: string;
          organization_relationship: string;
          owner_id: string;
        };
        Insert: {
          contact_id: string;
          contact_relationship: string;
          created_at?: string;
          id?: string;
          notes?: string | null;
          organization_id: string;
          organization_relationship: string;
          owner_id?: string;
        };
        Update: {
          contact_id?: string;
          contact_relationship?: string;
          created_at?: string;
          id?: string;
          notes?: string | null;
          organization_id?: string;
          organization_relationship?: string;
          owner_id?: string;
        };
        Relationships: [
          {
            foreignKeyName:
              "contact_organization_relationship_organization_id_owner_id_fkey";
            columns: ["organization_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id", "owner_id"];
          },
          {
            foreignKeyName:
              "contact_organization_relationships_contact_id_owner_id_fkey";
            columns: ["contact_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id", "owner_id"];
          },
        ];
      };
      contact_relationships: {
        Row: {
          contact_id: string;
          created_at: string;
          id: string;
          inverse_relationship: string;
          notes: string | null;
          owner_id: string;
          related_contact_id: string;
          relationship: string;
        };
        Insert: {
          contact_id: string;
          created_at?: string;
          id?: string;
          inverse_relationship: string;
          notes?: string | null;
          owner_id?: string;
          related_contact_id: string;
          relationship: string;
        };
        Update: {
          contact_id?: string;
          created_at?: string;
          id?: string;
          inverse_relationship?: string;
          notes?: string | null;
          owner_id?: string;
          related_contact_id?: string;
          relationship?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contact_relationships_contact_id_owner_id_fkey";
            columns: ["contact_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id", "owner_id"];
          },
          {
            foreignKeyName:
              "contact_relationships_related_contact_id_owner_id_fkey";
            columns: ["related_contact_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id", "owner_id"];
          },
        ];
      };
      contacts: {
        Row: {
          carddav_href: string;
          carddav_uid: string;
          carddav_vcard: string | null;
          company: string | null;
          created_at: string;
          deleted_at: string | null;
          email: string | null;
          id: string;
          info: string | null;
          name: string;
          owner_id: string;
          phone: string | null;
          title: string | null;
          updated_at: string;
        };
        Insert: {
          carddav_href?: string;
          carddav_uid: string;
          carddav_vcard?: string | null;
          company?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          email?: string | null;
          id?: string;
          info?: string | null;
          name: string;
          owner_id?: string;
          phone?: string | null;
          title?: string | null;
          updated_at?: string;
        };
        Update: {
          carddav_href?: string;
          carddav_uid?: string;
          carddav_vcard?: string | null;
          company?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          email?: string | null;
          id?: string;
          info?: string | null;
          name?: string;
          owner_id?: string;
          phone?: string | null;
          title?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      history: {
        Row: {
          body: string;
          contact_id: string;
          created_at: string;
          happened_at: string;
          id: string;
          kind: string;
          owner_id: string;
        };
        Insert: {
          body: string;
          contact_id: string;
          created_at?: string;
          happened_at?: string;
          id?: string;
          kind: string;
          owner_id?: string;
        };
        Update: {
          body?: string;
          contact_id?: string;
          created_at?: string;
          happened_at?: string;
          id?: string;
          kind?: string;
          owner_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "history_contact_id_owner_id_fkey";
            columns: ["contact_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id", "owner_id"];
          },
        ];
      };
      organization_relationships: {
        Row: {
          created_at: string;
          id: string;
          inverse_relationship: string;
          notes: string | null;
          organization_id: string;
          owner_id: string;
          related_organization_id: string;
          relationship: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          inverse_relationship: string;
          notes?: string | null;
          organization_id: string;
          owner_id?: string;
          related_organization_id: string;
          relationship: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          inverse_relationship?: string;
          notes?: string | null;
          organization_id?: string;
          owner_id?: string;
          related_organization_id?: string;
          relationship?: string;
        };
        Relationships: [
          {
            foreignKeyName:
              "organization_relationships_organization_id_owner_id_fkey";
            columns: ["organization_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id", "owner_id"];
          },
          {
            foreignKeyName:
              "organization_relationships_related_organization_id_owner_i_fkey";
            columns: ["related_organization_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id", "owner_id"];
          },
        ];
      };
      organizations: {
        Row: {
          address: string | null;
          created_at: string;
          email: string | null;
          id: string;
          info: string | null;
          kind: string;
          name: string;
          owner_id: string;
          phone: string | null;
          updated_at: string;
          website: string | null;
        };
        Insert: {
          address?: string | null;
          created_at?: string;
          email?: string | null;
          id?: string;
          info?: string | null;
          kind?: string;
          name: string;
          owner_id?: string;
          phone?: string | null;
          updated_at?: string;
          website?: string | null;
        };
        Update: {
          address?: string | null;
          created_at?: string;
          email?: string | null;
          id?: string;
          info?: string | null;
          kind?: string;
          name?: string;
          owner_id?: string;
          phone?: string | null;
          updated_at?: string;
          website?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema =
  DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof (
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
        "Tables"
      ]
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
        "Views"
      ]
    )
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? (
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Tables"
    ]
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Views"
    ]
  )[TableName] extends {
    Row: infer R;
  } ? R
  : never
  : DefaultSchemaTableNameOrOptions extends keyof (
    & DefaultSchema["Tables"]
    & DefaultSchema["Views"]
  ) ? (
      & DefaultSchema["Tables"]
      & DefaultSchema["Views"]
    )[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R;
    } ? R
    : never
  : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Tables"
    ]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
    "Tables"
  ][TableName] extends {
    Insert: infer I;
  } ? I
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I;
    } ? I
    : never
  : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Tables"
    ]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
    "Tables"
  ][TableName] extends {
    Update: infer U;
  } ? U
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U;
    } ? U
    : never
  : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]][
      "Enums"
    ]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][
    EnumName
  ]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[
      PublicCompositeTypeNameOrOptions["schema"]
    ]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
} ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]][
    "CompositeTypes"
  ][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
