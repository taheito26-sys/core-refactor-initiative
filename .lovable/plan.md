
# 40 Phases — Chat UX/UI/Design/Layout Enhancement Roadmap

## A. Message Experience (1–10)
1. **Swipe-to-reply gesture** — Swipe right on a message bubble to trigger reply (mobile)
2. **Message bubble tail shapes** — Add WhatsApp-style SVG tails on first-in-group bubbles
3. **Emoji-only big render** — Messages with 1–3 emoji only render at 2× size, no bubble
4. **Staggered entrance animation** — New messages slide up with spring physics (framer-motion)
5. **Long-press haptic feedback** — Trigger device haptics on mobile long-press actions
6. **Inline link previews** — Auto-fetch OG metadata and render card previews below links
7. **Voice note waveform playback** — Animated waveform bar that tracks playback progress
8. **Read receipt tooltips** — Hover on double-tick to see "Read at 3:42 PM" tooltip
9. **Message edit indicator** — Show "(edited)" label with hover tooltip of edit timestamp
10. **Smooth scroll-to-bottom FAB** — Floating button with unread count badge, spring animation

## B. Conversation List (11–18)
11. **Swipe actions on rows** — Swipe left → archive/delete, swipe right → pin/mute
12. **Pinned conversations section** — Visual separator + pin icon for pinned rooms
13. **Conversation avatar status ring** — Online = green ring, away = amber ring around avatar
14. **Last message preview truncation** — Smart truncate with "📎 Photo" / "🎙 Voice" labels
15. **Typing preview in list** — Replace last message with "typing..." when contact is typing
16. **Unread count pill redesign** — Gradient pill with muted-style for muted conversations
17. **Search-as-you-type filtering** — Instant fuzzy search over room names in sidebar
18. **Empty state illustration** — Branded illustration when no conversations exist yet

## C. Composer & Input (19–24)
19. **Mention autocomplete** — @mention members with popup picker in group rooms
20. **Emoji picker popover** — Grid-based emoji picker with categories + recent
21. **Drag-and-drop file upload** — Drop zone overlay on the message area
22. **Paste-image support** — Clipboard paste → instant image attachment preview
23. **Character count for long messages** — Subtle count near limit (e.g., 4096 chars)
24. **Composer height transition** — Smooth CSS transition when textarea auto-grows

## D. Layout & Navigation (25–32)
25. **Resizable sidebar width** — Drag-handle between sidebar and thread (desktop)
26. **Keyboard shortcuts overlay** — ⌘K command palette for power users (search, navigate)
27. **Breadcrumb room path** — Show "Inbox > Team > Room Name" for nested navigation
28. **Split-view context panel** — Slide-out right panel for room info / shared media
29. **Compact density mode** — Toggle between comfortable and compact message spacing
30. **Full-screen thread mode** — F11 / button to expand thread to fill viewport
31. **Transition animations between panes** — Slide left/right on mobile pane switches
32. **Sticky date headers** — Date separators stick to top while scrolling through messages

## E. Visual Polish & Theming (33–40)
33. **Chat wallpaper selector** — Choose from preset subtle patterns or solid colors
34. **Bubble color customization** — Let users pick outgoing bubble accent color
35. **Dark mode contrast audit** — Ensure all elements pass WCAG AA in dark mode
36. **Micro-interaction on send** — Send button pulse + bubble "pop-in" on message send
37. **Skeleton loading shimmer** — Replace spinner with message-shaped skeleton placeholders
38. **Avatar fallback gradient** — Unique gradient per user based on ID hash (not plain color)
39. **Focus ring accessibility** — Visible keyboard focus rings on all interactive elements
40. **Scroll progress indicator** — Thin progress bar at top of message area showing scroll position
