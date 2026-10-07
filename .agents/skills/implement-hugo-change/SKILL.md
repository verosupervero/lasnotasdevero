---
name: implement-hugo-change
description: Implement a planned Hugo site change with minimal scope. Use when the desired behavior, relevant files, and acceptance criteria are already understood.
---

# Implement a Hugo change

## Before editing

Confirm:

1. The relevant files still match the map/plan.
2. The requested behavior is unambiguous enough to implement.
3. No existing helper/partial already provides the needed behavior.

If a material assumption is wrong, report it rather than improvising a broad solution.

## Implementation rules

### Keep scope narrow

Modify only files needed for the requested behavior.

Do not:
- mass-format;
- rename unrelated variables/classes;
- reorganize templates;
- migrate content;
- update dependencies;
- rewrite prose;
- "clean up" neighboring code.

### Follow Hugo conventions already present

Prefer:
- partials for reused markup;
- existing base/block structure;
- existing Hugo collections and sort/filter patterns;
- existing Hugo Pipes setup;
- existing content types/archetypes/frontmatter conventions.

### Frontmatter compatibility

Unless explicitly told otherwise:

- absent `featured` behaves as 0;
- `featured: 0` is normal;
- `featured: 1` is secondary priority;
- `featured: 2` is primary priority.

Do not add `featured: 0` to every historical content file.

### Presentation changes

Use existing CSS naming/patterns.

Do not add JavaScript for a behavior that Hugo templates or CSS can handle cleanly.

### URLs and content

Preserve:
- slugs;
- permalinks;
- aliases;
- shortcode syntax;
- internal links;
- resource paths.

unless the task explicitly changes them.

## After editing

Inspect the diff.

Remove:
- accidental whitespace churn;
- generated output accidentally mixed with source edits;
- unrelated edits.

Report:

```text
Changed:
- path — purpose

Behavior implemented:
...

Needs verification:
...
```

Do not claim success until verification has run.
