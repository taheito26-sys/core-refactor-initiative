# Walkthrough - Voice and Messaging Fixes

![Modern Merchant Messaging OS Design Pivot](C:/Users/User/.gemini/antigravity/brain/6984f700-fd97-4fc2-bb11-cf1f9fc2ae8b/modern_merchant_messaging_os_pivot_1774606625619.png)

I have resolved the critical failures in the messaging system, focusing on voice playback, calls, and the one-time view feature. The messaging codebase has been hardened by consolidating redundant logic and implementing missing real-time signaling.

## Changes Made

### 1. Consolidated Message Codec
Standardized the way rich messages (voice, polls, replies, etc.) are encoded and parsed across both chat implementations.
- Updated [src/features/chat/lib/message-codec.ts](file:///c:/Data/core-refactor-initiative/src/features/chat/lib/message-codec.ts) as the single source of truth.
- Implemented `||VIEWED||` tag support to track message state within the content string itself, ensuring persistence across sessions.

### 2. Optimized Voice Playback
Improved the reliability and performance of voice message playback.
- Refactored [VoicePlayer](file:///c:/Data/core-refactor-initiative/src/features/chat/components/MessageItem.tsx#41-139) in both [MessageItem.tsx](file:///c:/Data/core-refactor-initiative/src/features/chat/components/MessageItem.tsx) and [UnifiedChatInbox.tsx](file:///c:/Data/core-refactor-initiative/src/features/merchants/components/UnifiedChatInbox.tsx).
- Switched from large `data:` URIs to memory-efficient `Blob` objects and `URL.createObjectURL()`.

### 3. One-Time View Enforcement
Implemented logic to ensure sensitive messages are only viewed once.
- Added a "Click to Reveal" placeholder for one-time messages.
- Once viewed, the message is marked with a `||VIEWED||` tag and hidden from further display.
- Integrated with both `os_messages` and `merchant_messages` tables.

### 4. Voice Call Signaling (WebRTC)
Restored the broken voice calling functionality with a robust signaling layer.
- Created [useWebRTC.ts](file:///c:/Data/core-refactor-initiative/src/features/chat/hooks/useWebRTC.ts) to manage peer connections and media streams.
- Implemented a global [call-store.ts](file:///c:/Data/core-refactor-initiative/src/lib/call-store.ts) for consistent call state across the app.
- Updated [CallOrchestrator.tsx](file:///c:/Data/core-refactor-initiative/src/features/chat/components/CallOrchestrator.tsx) with a premium floating UI for incoming, active, and outgoing calls.

## Verification Results

### Automated Tests
Successfully ran unit tests for the message codec to verify parsing of voice, polls, and viewed markers.
- `npm run test src/test/message-codec.test.ts` -> **All Tests Passed**

### Manual Verification
1. **Voice Messages**: Verified base64 encoding/decoding and blob-based playback.
2. **One-Time View**: Confirmed that messages transition from "Reveal" to "Viewed" state and remain hidden after a page refresh.
3. **Voice Calls**: Validated signaling flow (Offer/Answer/Candidate) via Supabase Realtime Broadcast.

> [!NOTE]
> The WebRTC implementation uses Google's public STUN server for ICE candidate discovery. For production environments with strict firewalls, a dedicated TURN server may be required.
