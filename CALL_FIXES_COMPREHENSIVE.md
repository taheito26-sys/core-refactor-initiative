# Comprehensive Call Fixes

## Issues to Fix

1. **Screen lock kills audio** - Mobile browsers suspend audio when screen locks
2. **Video calls not working** - Remote video tracks arrive after component renders
3. **Add full mobile controls** - Speaker/earpiece, hold, keypad, flip camera, add call, etc.

## Root Causes

### Issue 1: Screen Lock Audio Death
- Mobile browsers pause `<audio>` elements when `document.hidden === true`
- `AudioContext` is suspended on visibility change
- No `visibilitychange` / `pageshow` / `resume` handlers to restore playback
- WebRTC `RTCPeerConnection` stays connected but audio element stops playing

### Issue 2: Video Not Working
- `showVideo` computed as: `(isVideoCall || hasVideo) && (isActive || isConnecting)`
- On first render after `ontrack` fires, `remoteStream` is set but component hasn't re-rendered yet
- The video branch never mounts because `showVideo` is false on the render where `remoteStream` arrives
- Need to check `remoteStream` directly, not just track counts

### Issue 3: Missing Controls
- Only mute + video + end call currently
- Need: speaker/earpiece toggle, hold, DTMF keypad, flip camera, add call

## Fixes

### Fix 1: Page Lifecycle Handlers (useWebRTC.ts)

Add a new `useEffect` after the `beforeunload` handler:

```typescript
// ── page lifecycle: keep call alive on screen lock ────────────────────
useEffect(() => {
  if (!callIdRef.current) return;

  const handleVisibilityChange = () => {
    // Mobile browsers pause <audio> on visibility hidden.
    // Force resume when page becomes visible again.
    if (!document.hidden && remoteAudioRef.current) {
      remoteAudioRef.current.play().catch(() => {});
    }
  };

  const handlePageShow = () => {
    // iOS Safari: page restored from bfcache
    if (remoteAudioRef.current) {
      remoteAudioRef.current.play().catch(() => {});
    }
  };

  const handleFreeze = () => {
    // Page Lifecycle API: page about to be frozen (mobile background)
    console.log('[WebRTC] page freeze — call will suspend');
  };

  const handleResume = () => {
    // Page Lifecycle API: page resumed from freeze
    console.log('[WebRTC] page resume — restoring audio');
    if (remoteAudioRef.current) {
      remoteAudioRef.current.play().catch(() => {});
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pageshow', handlePageShow);
  document.addEventListener('freeze', handleFreeze);
  document.addEventListener('resume', handleResume);

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pageshow', handlePageShow);
    document.removeEventListener('freeze', handleFreeze);
    document.removeEventListener('resume', handleResume);
  };
}, []);
```

**Problem:** `remoteAudioRef` is in `CallOverlay`, not `useWebRTC`. Need to pass a ref or expose a `resumeAudio()` method.

**Better solution:** Add the audio element ref to `useWebRTC` and expose it, OR add a `resumeAudio` callback to the return type.

### Fix 2: Video Track Detection (CallOverlay.tsx)

Change `showVideo` logic:

```typescript
// OLD (broken):
const showVideo = (isVideoCall || isScreenSharing || localHasVideo || remoteHasVideo) && (isActive || isConnecting);

// NEW (works):
const showVideo = (isVideoCall || isScreenSharing || remoteStream) && (isActive || isConnecting);
```

The `remoteStream` check is more reliable than counting tracks because the stream object is set immediately when `ontrack` fires, even if the component hasn't re-rendered yet.

### Fix 3: Full Mobile Controls (CallOverlay.tsx)

Add state + handlers:
- `speakerMode: 'earpiece' | 'speaker' | 'bluetooth'`
- `isOnHold: boolean`
- `showKeypad: boolean`
- `dtmfInput: string`
- `frontCamera: boolean`

Add control buttons in a 3x3 grid:
```
Row 1: Mute    | Speaker  | Video
Row 2: Keypad  | Hold     | Add Call
Row 3: (empty) | End Call | (empty)
```

For video calls, add flip camera button in the PiP overlay.

## Implementation Order

1. Fix video detection first (simplest)
2. Add visibility handlers to useWebRTC
3. Add full controls to CallOverlay
4. Test on mobile with screen lock
5. Commit and push all at once
