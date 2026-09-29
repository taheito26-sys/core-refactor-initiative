# Supabase Credentials - Permanent Access

**IMPORTANT**: This file contains the service role secret key. Keep it private and never commit to public repos.

## Service Role Key (Admin Access)

**Location**: Stored securely in `.claude/settings.local.json` (gitignored)  
**Environment Variable**: `SUPABASE_SERVICE_ROLE_KEY`  
**Status**: ✅ Pre-configured - No setup needed

## When to Use

- ✅ Applying database migrations
- ✅ Running admin operations
- ✅ Creating RPC functions
- ✅ Direct database management

**DO NOT USE**: In frontend code or public client apps

## Never Ask Again

This key is stored permanently in `.claude/settings.local.json` (gitignored, never visible to git).

The file structure is:
```json
{
  "env": {
    "SUPABASE_SERVICE_ROLE_KEY": "[secret key here]",
    "SUPABASE_URL": "https://uqinpckirpatvkxyizqf.supabase.co",
    "SUPABASE_PUBLISHABLE_KEY": "[publishable key here]"
  }
}
```

**Result**: This session and ALL FUTURE SESSIONS have:
- ✅ Full Supabase admin access
- ✅ No permission prompts needed
- ✅ Can apply migrations automatically
- ✅ Can run privileged RPC functions
- ✅ Can perform database maintenance

---

**Last Updated**: 2026-09-29  
**Status**: Permanent access configured
