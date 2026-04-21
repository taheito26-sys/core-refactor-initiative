# Rule: Never Assume Anything Is Working Unless Tested

## Core Principle

**Do not claim a fix works until the user confirms it works in the actual running app.**

This applies to every change — UI, logic, API, infrastructure, configuration.

## What This Means in Practice

### Before saying "this is fixed":
- The code compiles with no TypeScript errors (`tsc --noEmit` passes)
- The code has no lint/diagnostic errors
- The change is committed and pushed so Vercel deploys it
- The user has tested it on the actual device/browser and confirmed it works

### Never say things like:
- "This should fix the issue"
- "The problem is now resolved"
- "This will work because..."
- "The fix has been applied"

### Instead say things like:
- "Pushed — please test on your device and let me know what you see"
- "Deployed — try it and confirm if X works now"
- "This is the approach — test it and report back"

## Specific Lessons Learned in This Project

### WebRTC / Calls
- ICE connection "succeeds" in logs does not mean audio flows — test actual audio
- `addIceCandidate` returning OK does not mean pairs formed — check `getStats()`
- `fixed` positioning "should" escape overflow — test on the actual device
- `visibilitychange` handler "should" resume audio — test by actually locking the screen
- `setSinkId` "should" switch speaker — test on the actual mobile browser
- `toggleMute` "should" work — test by actually muting during a live call
- Video renegotiation "should" work — test by toggling video during an active call

### Mobile / PWA
- Hard refresh clears cache — but Vercel may not have deployed yet, check the build ID in console
- `fixed inset-0` escapes overflow — but only after the portal fix was committed and deployed
- `useIsMobile` returns correct value — but only after the first render cycle

### Deployment
- Code change in editor ≠ deployed to production
- `git commit` ≠ pushed to remote
- `git push` ≠ Vercel finished building
- Vercel finished building ≠ user has refreshed their browser

## Workflow

1. Make the change
2. Run diagnostics / typecheck then test it yourself
3. Commit and push to main
4. Tell the user: "Pushed — wait for Vercel to deploy, then hard refresh and test"
5. Wait for user confirmation before marking anything as resolved
6. If user says it still doesn't work — do NOT assume the old fix was correct and patch on top. Diagnose from scratch.

## Progress Bar Rule

**Always show a progress bar when doing multi-step work (3+ steps).**

Format:
```
Progress: [████████░░] 8/10 — Writing CustomerOrdersPage
```

Rules:
- Filled block `█` for completed steps, empty block `░` for remaining
- Show current step label after the fraction
- Update after every completed step
- Use this for: multi-file implementations, spec task execution, debugging sessions, any work with 3+ distinct steps

## Tool Call Rate Limit Rule — NEVER produce "Too many requests"

Root cause: too many tool calls in rapid succession within one response.

**Prevention rules (follow strictly):**
1. **Batch reads** — use `readMultipleFiles` for 2+ files, never multiple `readFile` calls
2. **Batch writes** — write all content for a file in ONE `strReplace`, not many small anchored calls
3. **No sequential probing** — do not chain `grepSearch` → `readFile` → `grepSearch` → `readFile`; read the full file once
4. **Max 5 tool calls per response** — if more are needed, stop and tell the user "continuing in next message"
5. **Combine git at the end** — `git add` + `git commit` + `git push` = 3 calls; always do them last, together
6. **No redundant checks** — do not run both `tsc --noEmit` and `getDiagnostics` in the same response
7. **Write large files via PowerShell** — use `Set-Content` for files >100 lines rather than multiple `strReplace` anchors
8. **Never loop tool calls** — if a pattern requires calling the same tool 3+ times, restructure the approach
