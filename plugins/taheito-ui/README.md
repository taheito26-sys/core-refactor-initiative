# taheito-ui

A Claude Code plugin holding one skill, `taheito-ui`: the card dashboard design used by the Orders, Cash,
Shipments and driver pages of The Tracker. The skill's CSS in `skills/taheito-ui/assets/` is copied from
`src/styles/customer-*.css`; when those files change, copy them again and bump `version` in
`.claude-plugin/plugin.json` so installed copies update.

Install in any project, once per machine:

```
/plugin marketplace add taheito26-sys/core-refactor-initiative
/plugin install taheito-ui@taheito
```

Or enable it for everyone who opens a project, by committing this to that project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "taheito": { "source": { "source": "github", "repo": "taheito26-sys/core-refactor-initiative" } }
  },
  "enabledPlugins": { "taheito-ui@taheito": true }
}
```

In this repo the skill is also linked at `.claude/skills/taheito-ui`, so it loads without installing.
