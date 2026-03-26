# Antigravity Messaging OS Reference Extraction and Implementation Spec

## 1) Feature Extraction Matrix

| Feature Domain | Primary Source | Adopted Pattern |
|---|---|---|
| Secure messaging + RBAC + extensibility | Rocket.Chat | Room + message policy layers, member-scoped access, auditable actions |
| Workflow automation + notifications + command model | Mattermost | RPC-driven action orchestration, trigger fan-out, deterministic notification metadata |
| Unified inbox + lane segmentation + assignment style | Chatwoot | Lane-based inbox, omnichannel identity stitching, operator context panels |
| Connector/transport normalization | Evolution API | Provider identity registry, webhook-friendly payload normalization model |
| Chat as operations timeline | Expensify App | Unified timeline where messages and operational objects co-exist |
| Widget unread lifecycle | react-chat-widget | Stable unread counters and badge semantics tied to attention |
| Keyboard-first desktop usage | lencx ChatGPT | Global shortcuts for navigation/composer and command affordances |

## 2) Data Model

Core entities implemented:
- User (existing auth/profiles/roles)
- Room: `os_rooms`
- Thread: `os_threads`
- Message: `os_messages`
- ChannelIdentity: `os_channel_identities`
- BusinessObject: `os_business_objects`
- Policy: `os_policies`
- AuditEvent: `os_audit_events`

Additional required entities for full 20-feature support:
- Presence: `os_room_presence`
- Workflow Runs: `os_workflow_runs`
- Snapshots: `os_snapshots`
- Trust metrics: `os_trust_metrics`
- Vault items: `os_vault_items`
- Location shares: `os_location_shares`
- Call metadata: `os_call_sessions`, `os_call_events`
- Compliance/legal holds: `os_compliance_holds`

## 3) Component Architecture

- Inbox: split-lane sidebars (`ConversationSidebar`, `ModernSidebar`)
- Conversation: `ChatPage` orchestration + timeline/composer/header in dual layouts
- Message: `MessageItem` and `ModernTimeline` message renderer with permissions + vanish behavior
- Notification: deep-link resolver via `notification-router` and exact anchor handling
- MiniAppContainer: inline app panel in `ChatPage` with backend-validated app intents

## 4) API Specification (RPC/DB Contract)

- `os_create_message`: create policy-compliant message with room/message security defaults
- `os_convert_message`: convert message to business object with source linkage and workflow run
- `os_promote_thread`: promote message set to routed thread preserving context
- `os_send_notification`: send exact-anchor notifications with smart-unread suppression
- `os_create_snapshot`: immutable snapshot creation with trigger_event and legal-hold compatibility
- `os_accept_negotiation_terms`: lock terms and create immutable snapshot
- `os_mark_room_read`: mark all unseen messages as read for current merchant
- `os_get_unread_counts`: unread by room with active-view suppression logic
- `os_search_messages`: search excluding expired/deleted content unless policy allows
- `os_record_presence`: focused presence updates for smart unread
- `os_set_legal_hold`, `os_compliance_fetch_message`, `os_compliance_audit_query`
- `os_compute_trust_score`
- `os_validate_mini_app_intent`

## 5) Implementation Roadmap

### Phase 1 — Security and Core Messaging Integrity
- Room/message policy enforcement in API + RLS
- Expiration/retention/search visibility correctness
- Audit trail and exact message notification fan-out

### Phase 2 — Workflow and Omnichannel Operations
- Message conversion, thread promotion, snapshot chain
- Channel identity stitching and dual timeline consistency
- Smart unread durability via presence model

### Phase 3 — Trust, Compliance, and Embedded Operations
- Trust score + factor reporting
- Vault/location/call metadata with expiry and legal-hold pathways
- Inline mini-app validation and command execution semantics
