# Deploy Instructions for Call UI Changes

The CallOverlay component has been redesigned with iPhone-style full-screen UI on mobile.

## Changes Made

1. **Mobile incoming call** - Full-screen with large pulsing avatar, Accept/Decline buttons
2. **Mobile active audio call** - Full-screen with avatar, duration, mute/video controls
3. **Mobile calling/connecting** - Full-screen with animated avatar and spinner
4. **Mobile video call** - Changed from `absolute` to `fixed` positioning for true full-screen

All mobile states now use `fixed inset-0 z-50` to cover the entire viewport.

## To See the Changes

### Local Development
```bash
# Stop the dev server if running (Ctrl+C)
# Clear the build cache
rm -rf dist node_modules/.vite

# Rebuild
npm run build

# Or restart dev server
npm run dev
```

### Production (Vercel)
```bash
# Commit and push the changes
git add src/features/chat/components/CallOverlay.tsx
git commit -m "Redesign mobile call UI to iPhone-style full-screen"
git push origin main
```

Vercel will automatically rebuild and deploy.

### Clear Browser Cache
After deployment, hard refresh the page:
- **Chrome/Edge**: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
- **Safari**: Cmd+Option+R
- **Mobile**: Close the tab completely and reopen

## Testing on Mobile

1. Open the app on a mobile device (screen width < 768px)
2. Start a call
3. You should see:
   - **Incoming**: Full-screen dark gradient with large avatar and Accept/Decline buttons
   - **Connected**: Full-screen with avatar, duration timer, and control buttons at bottom
   - **Video**: Full-screen video with controls overlay

## Breakpoint

Mobile UI activates when `window.innerWidth < 768px` (defined in `src/hooks/use-mobile.tsx`)

Desktop (≥768px) keeps the compact floating bar at the top.
