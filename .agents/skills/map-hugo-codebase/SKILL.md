---
name: map-hugo-codebase
description: Trace where a Hugo site behavior is implemented before changing it. Use for unfamiliar features, homepage logic, template lookup, partials, content/frontmatter flow, styles, scripts, or "where is this generated?" questions.
---

# Map a Hugo code path

Use this skill before implementation when the responsible files are not already known.

## Goal

Produce a factual map of the smallest code/content path that explains the requested behavior.

Do not edit files while performing this workflow.

## Workflow

### 1. Define the observable behavior

Write one sentence describing what is being traced.

Examples:

- "Which code chooses and renders articles on the homepage?"
- "Where does `featured` frontmatter affect card layout?"
- "Which partial renders article metadata?"
- "Why does this shortcode produce this HTML?"

Avoid starting from an assumed filename.

### 2. Find entry points

Search for the visible text, class, parameter, partial name, shortcode, route, frontmatter key, or generated HTML characteristic involved.

Inspect repository structure only as needed.

Potential locations:

- `content/`
- `layouts/`
- `assets/`
- `static/`
- `data/`
- `themes/`
- Hugo config
- JS/CSS build tooling

### 3. Trace Hugo resolution

When templates are involved, identify:

- content/page kind;
- list vs single vs home;
- base template and block;
- partials;
- shortcodes;
- data/frontmatter inputs;
- theme/module file vs local override.

Do not stop at the first file that contains matching text.

### 4. Trace presentation dependencies

If the behavior is visual, identify only the CSS/JS/assets that materially affect it.

Do not inventory the entire stylesheet.

### 5. Find precedent

Search for another part of the repository already solving a similar problem.

Existing project patterns are stronger evidence than generic Hugo advice.

### 6. Report facts and unknowns separately

Use this output shape:

```text
Behavior traced:
...

Entry point:
...

Relevant files:
- path — role
- path — role

Flow:
A -> B -> C -> rendered result

Existing convention to reuse:
...

Unknowns / risks:
...
```

If you know the likely edit location, identify it, but do not produce a patch.
