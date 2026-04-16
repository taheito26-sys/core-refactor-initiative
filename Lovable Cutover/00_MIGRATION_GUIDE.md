# Full Migration Guide: Lovable Cloud → External Supabase

## Exported Files

| File | Description |
|------|-------------|
| `01_enums.sql` | Custom enum types (app_role, chat_call_status, etc.) |
| `02_schema_full.sql` | Complete DDL: tables, indexes, constraints, views, sequences |
| `03_rls_policies.sql` | All Row-Level Security policies |
| `04_data_inserts.sql` | Full data export as INSERT statements (~259MB, 72 tables) |
| `05_functions.sql` | All 80+ database functions/RPCs |
| `06_triggers.sql` | All triggers |
| `07_storage_buckets.txt` | Storage bucket configuration |
| `08_row_counts.txt` | Row counts per table for verification |

## Migration Steps

### 1. Create New Supabase Project
- Go to https://supabase.com/dashboard
- Create a new project, note the project URL and anon key

### 2. Run Schema Migration (in order)
```bash
# Connect to new project's SQL editor or psql
# Step 1: Enums first
psql -f 01_enums.sql

# Step 2: Full schema (tables, indexes, constraints)
psql -f 02_schema_full.sql

# Step 3: Functions
psql -f 05_functions.sql

# Step 4: Triggers  
psql -f 06_triggers.sql

# Step 5: RLS policies
psql -f 03_rls_policies.sql

# Step 6: Data (this is large ~259MB)
psql -f 04_data_inserts.sql
```

### 3. Storage Buckets
Create these buckets in the new project:
- `payment-proofs` (private)
- `chat-attachments` (private, 100MB limit, restricted MIME types)

### 4. Edge Functions
Copy the `supabase/functions/` directory from your repo and deploy:
```bash
supabase functions deploy --project-ref <new-project-ref>
```

### 5. Update App Configuration
Update your `.env` or environment variables:
```
VITE_SUPABASE_URL=https://<new-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<new-anon-key>
```

### 6. Auth Users
⚠️ Auth users live in `auth.users` (Supabase-managed schema).
You cannot export these directly via SQL.
Options:
- Use Supabase CLI: `supabase auth export --project-ref <old-ref>`
- Or have users re-register on the new project

### 7. Secrets
Re-add any edge function secrets in the new project dashboard.

### 8. Verify
- Check row counts match `08_row_counts.txt`
- Test auth flow
- Test critical features (chat, orders, P2P)

## Key Stats
- **72 tables** with data
- **80+ functions/RPCs**  
- **52,096 P2P snapshots** (largest table)
- **2 storage buckets**
- **6 custom enums**
