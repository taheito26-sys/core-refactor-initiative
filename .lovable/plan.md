
# 25 Phases — Watermark & Privacy Enhancement Roadmap

Each phase contains 3+ features for comprehensive security coverage.

## A. Watermark Core System (1–5)

### Phase 1: Dynamic Watermark Engine
- Configurable watermark text with user ID, timestamp, and custom labels
- Density control (light / medium / heavy) with adjustable opacity + spacing
- SVG pattern-based rendering with diagonal rotation for tamper resistance

### Phase 2: Room-Level Watermark Policies
- Per-room watermark toggle in room settings / policies
- Watermark inheritance from room type defaults (merchant_private = always on)
- Admin override to force watermarks on specific rooms regardless of type

### Phase 3: Watermark on Media Previews
- Overlay watermark on image previews before full-screen view
- Watermark on document/PDF preview panels
- Watermark on video thumbnail frames during inline playback

### Phase 4: Watermark on Exports & Downloads
- Burn-in watermark on exported chat transcripts (PDF/text)
- Watermark stamped on downloaded images before saving
- Watermark overlay on forwarded message previews

### Phase 5: Watermark Audit Trail
- Log every watermark render event (user, room, timestamp, density)
- Track watermark bypass attempts (screenshot detection signals)
- Admin dashboard widget showing watermark activity stats

## B. Screenshot & Screen Recording Protection (6–10)

### Phase 6: Screenshot Detection
- Detect PrintScreen / ⌘+Shift keystrokes and log audit event
- Blur sensitive content momentarily on screenshot key detection
- Push notification to room owner when screenshot is detected

### Phase 7: Screen Share Watermark
- Full-overlay watermark during active WebRTC screen sharing
- Dynamic text updates every 30s with fresh timestamp
- Screen share indicator badge visible to all room participants

### Phase 8: CSS Screenshot Protection
- Apply `user-select: none` on sensitive message bubbles
- Disable right-click context menu on protected media
- CSS `filter: blur()` on sensitive content when window loses focus

### Phase 9: Screen Recording Deterrence
- Detect `getDisplayMedia` API calls and warn users
- Periodic foreground/background state monitoring with audit logs
- Visual "CONFIDENTIAL" flash overlay on protected rooms when tab hidden

### Phase 10: Media Viewer Protection
- Disable long-press save on mobile image lightbox
- Block drag-to-desktop on image elements
- Watermark overlay scales with zoom level in lightbox

## C. Message Privacy Controls (11–15)

### Phase 11: View-Once Message Hardening
- View-once messages auto-delete from local cache after viewing
- Block forwarding/copying/saving of view-once content
- Countdown timer overlay showing remaining view time

### Phase 12: Disappearing Messages Engine
- Per-message custom expiry timer (1min to 30 days)
- Room-level default disappearing timer setting
- Visual countdown badge on each disappearing message bubble

### Phase 13: Message Forwarding Controls
- Per-room toggle to disable message forwarding entirely
- "Forwarded" label with hop count (forwarded many times)
- Strip sender identity from forwarded messages in restricted rooms

### Phase 14: Copy & Select Protection
- Per-room disable text selection on message content
- Block clipboard copy via keyboard shortcuts in protected rooms
- Paste-blocking for sensitive content identifiers

### Phase 15: Read Receipt Privacy
- User-level toggle to hide read receipts from others
- "Last seen" privacy modes (everyone / contacts / nobody)
- Typing indicator privacy toggle per user

## D. Data Loss Prevention (16–20)

### Phase 16: File Upload Scanning
- Validate file types against room policy allowlist
- File size enforcement with clear error messaging
- MIME type verification (not just extension) before upload

### Phase 17: Sensitive Data Detection
- Regex patterns to detect credit card numbers in messages
- Flag messages containing potential phone numbers or emails
- Warning prompt before sending messages with detected PII

### Phase 18: Message Retention Policies
- Room-level retention period (7d / 30d / 90d / indefinite)
- Automatic purge of expired messages via scheduled function
- Retention policy indicator in room info panel

### Phase 19: Export Controls
- Per-room toggle to allow/deny chat export
- Export audit log (who exported, when, which room)
- Redacted export mode that masks sensitive fields

### Phase 20: Attachment Lifecycle
- Auto-expire attachment storage links after configurable TTL
- Revoke access to attachments when user leaves room
- Attachment access audit trail per file

## E. User Privacy & Identity (21–25)

### Phase 21: Anonymous Mode
- Allow users to join rooms with pseudonymous display names
- Hide real user ID from non-admin participants
- Anonymous avatar generation (unique per session, not traceable)

### Phase 22: Presence Privacy
- Granular online status visibility (all / room members / nobody)
- "Invisible" mode — appear offline while still receiving messages
- Last active timestamp privacy control per user

### Phase 23: Notification Privacy
- Strip message content from push notifications (show "New message" only)
- Sender name hiding in lock-screen notifications
- Notification preview privacy level (full / partial / none)

### Phase 24: Encryption Indicators
- Visual lock icon on end-to-end encrypted rooms
- Encryption status banner in room info panel
- Key fingerprint verification UI for contact identity confirmation

### Phase 25: Privacy Dashboard
- Centralized privacy settings page for all toggles
- Privacy score indicator (% of protections enabled)
- One-click "Maximum Privacy" preset that enables all protections
