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

---

## KIRO RATE-LIMIT PROTECTION PROTOCOL — Non-Negotiable Operational Rules

### OBJECTIVE
Prevent "Too many requests" and rate-limit failures by enforcing disciplined, minimal, and batched tool usage. Stability takes priority over speed.

---

### RULE 1 — PLAN BEFORE ANY TOOL CALL
Never call a tool immediately after reasoning. First build a compact execution plan listing:
- required inputs
- expected outputs
- number of tool calls required

If the plan requires more than 3 tool calls, you MUST redesign the plan to reduce the count.
**No planning = no tool execution.**

---

### RULE 2 — HARD TOOL CALL LIMIT
Within a single response cycle:
- Maximum allowed tool calls: **3**
- Preferred target: **1**
- Absolute maximum burst: **5**

If the task appears to require more than this:
1. STOP
2. Consolidate operations
3. Batch work into larger actions
4. Proceed only after reduction

---

### RULE 3 — BATCH OPERATIONS BY TYPE
Never perform micro-operations. Combine:
- Multiple reads → **one read** (`readMultipleFiles`)
- Multiple writes → **one write** (full file via `fsWrite` or single `strReplace`)
- Multiple checks → **one verification**

**Forbidden pattern:**
```
read → write → read → write → read → write
```
**Required pattern:**
```
read everything → process locally → write once → verify once
```

---

### RULE 4 — NO RETRY LOOPS
If a tool call fails:
- Do not retry immediately
- Do not loop
- Do not escalate call frequency

Instead:
1. Pause reasoning
2. Analyze cause
3. Adjust strategy
4. Attempt only one controlled retry

**Maximum retries allowed: 1**

---

### RULE 5 — RATE-LIMIT DETECTION
If any of the following occurs:
- "Too many requests"
- Rate limit / 429 response
- Quota exceeded
- Tool throttled

**Immediately switch to SAFE MODE.**

---

### RULE 6 — SAFE MODE BEHAVIOR
When SAFE MODE is triggered:
- Stop all non-essential tool calls
- Reduce call frequency
- Increase batching
- Prefer reasoning over execution
- Delay further tool usage until necessary

**Only one tool call is allowed while in SAFE MODE.**

---

### RULE 7 — COOLDOWN ENFORCEMENT
After a rate-limit event:
- Do not issue another tool call until:
  - You have redesigned the execution plan AND
  - Reduced expected tool calls

**Never continue the same call pattern.**

---

### RULE 8 — VERIFY ONLY ONCE
After completing changes:
- Perform exactly **one** verification step
- Never verify repeatedly unless a critical failure is detected

---

### RULE 9 — TOOL CALL EFFICIENCY PRINCIPLE
Every tool call must deliver significant progress.
If a call produces only minor information: **do not make it.**

---

### RULE 10 — STABILITY PRIORITY
Operational stability overrides: speed, completeness, curiosity, perfection.

If a choice exists between more calls or fewer calls — **always choose fewer calls.**

---

### MANDATORY BEHAVIOR SUMMARY
```
Plan first → Batch work → Execute once → Verify once → Retry once → Never loop
```

**Violation of these rules is considered a system error.**

---

## Tool Call Rate Limit Rule (Quick Reference)

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

---

## KIRO MUST TEST BEFORE SAYING IT'S DONE — Non-Negotiable

### Core Rule
**Kiro Dev must verify every change actually works before reporting it as complete.**

Saying "done", "fixed", "pushed", or "working" without running a verification step is a violation.

### What "tested" means for Kiro Dev

Before closing any task, Kiro must run at least ONE of:

| Change type | Required verification |
|---|---|
| TypeScript / logic change | `tsc --noEmit` passes with zero errors |
| UI component change | Build succeeds (`npm run build` or equivalent) |
| API / data change | Query or function call traced through to confirm correct output |
| Config / routing change | Build succeeds and route resolves |
| Multi-file refactor | Full build + grep to confirm no broken imports |

### Forbidden closing phrases (never use without proof)
- "Done!"
- "This is now fixed"
- "It should work now"
- "The issue is resolved"
- "I've implemented the fix"

### Required closing format
Always end with the verification result + what the user must do next:

```
Build: ✅ tsc --noEmit passed, 0 errors
Pushed to main — wait for Vercel, then test [specific action] and confirm.
```

### If verification is impossible (no build env, missing deps)
State it explicitly:
```
Could not run build verification (reason: ...).
Pushed — please test [specific action] on your device and report back.
```

### Escalation rule
If the user reports something still doesn't work after a "tested" fix:
1. Do NOT patch on top of the previous fix
2. Treat it as a fresh diagnosis — read the actual code, trace the actual data flow
3. State what the previous fix got wrong before proposing the next one
