# Lovable: Step-by-Step Implementation Guide

Follow these steps in exact sequence to complete the Merchant Trading OS modernization and backend database build.

### Step 1: Environment Sanitization
- **Action**: Delete the `bun.lockb` file from the root directory.
- **Action**: Ensure `package-lock.json` is present. Run `npm install` or equivalent to verify dependencies.
- **Goal**: Prevent Vercel build-time conflicts and ensure a stable Node.js environment.

### Step 2: Database Foundation (DDL)
- **Action**: Execute the **scripts/migrations/001_messaging_os_foundation.sql** script.
- **Goal**: Provision the core tables (`os_rooms`, `os_messages`, `os_room_members`) and set up initial RLS policies.

### Step 3: Functional Hardening (RPCs & Views)
- **Action**: Execute the **scripts/migrations/002_chat_functional_logic.sql** script.
- **Goal**: 
    - Create the `chat_room_summary_v` view for high-performance inbox loading.
    - Implement the `fn_chat_send_message` RPC for secure, idempotent message delivery.
    - Implement read-receipt logic.

### Step 4: Legacy Data Transit
- **Action**: Execute the **scripts/migrations/003_legacy_chat_transit.sql** script.
- **Goal**: Migrate historical messages from legacy `merchant_` tables to the new `os_` architecture while re-mapping Merchant IDs to User UUIDs.

### Step 5: API Layer Synchronization
- **Action**: Update `src/features/chat/api/rooms.ts` to query `chat_room_summary_v` instead of legacy tables.
- **Action**: Update `src/features/chat/api/messages.ts` to use the `os_messages` table and the `fn_chat_send_message` RPC.

### Step 6: Frontend Layout Hardening
- **Action**: Update `ChatWorkspacePage.tsx` to enforce a strictly fixed `100vh` viewport.
- **Action**: Remove any page-level scrollbars using `overflow-hidden` on the main container.
- **Action**: Ensure the global `AppSidebar` and `TopBar` are rendered as standard, light-themed components.

### Step 7: Real-time & Privacy Wiring
- **Action**: Wire the **Voice/Video Call** buttons in `ConversationHeader.tsx` to a Supabase broadcast channel named `room:{roomId}:calls`.
- **Action**: Ensure the **One-time view** and **24h Timer** state in `MessageComposer.tsx` is correctly passed to the `sendMessage` API as `expiresAt`.

### Step 8: Final Operational Audit
- **Verification**: Ensure the "Operational Readiness" view is replaced by real room data after the database scripts are applied.
- **Verification**: Confirm that the dynamic SVG watermark appears in all rooms where `isSecure` is true.
