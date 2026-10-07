---
name: review-hugo-change
description: Review a completed Hugo diff for correctness and regressions without editing it. Use after implementation and before final verification, especially for templates, content selection, frontmatter, shortcodes, assets, and homepage logic.
---

# Review a Hugo change

Review the diff against the user's requested behavior.

Do not implement fixes.

## Review order

### 1. Correctness

Does the patch actually produce the requested behavior?

Trace the changed values through templates/partials where necessary.

### 2. Regression risk

Look for:
- changed behavior outside the requested page/type;
- global CSS effects;
- partials used more broadly than expected;
- changed default behavior;
- altered URLs or content metadata;
- assumptions that fail with empty collections.

### 3. Hugo-specific behavior

Check:
- template scope (`.` vs `$`);
- `with`, `range`, `where`, `sort`, `first`, `default`, `isset`, etc. in context;
- missing params;
- draft/future content behavior;
- template lookup/override assumptions;
- resources/assets paths;
- shortcode safety.

### 4. Featured-content rules

When applicable:

- missing `featured` must be equivalent to 0;
- 0 is normal content;
- 1 is secondary featured priority;
- 2 is primary featured priority;
- ties should not create unstable or accidental behavior;
- empty/short result sets should not break rendering;
- the same article should not appear twice unless intended.

### 5. Scope

Flag unrelated refactors or content changes that increase risk.

### 6. Verification gaps

Identify behavior that still needs an actual build/output check.

## Findings format

Only report actionable findings.

```text
[severity] path:line
Problem:
Why it matters:
Expected behavior:
```

Severities:
- critical — site/data/security break with major impact;
- high — likely broken requested behavior or significant regression;
- medium — real edge-case or maintainability issue that can cause wrong behavior;
- low — minor but concrete defect.

Avoid subjective style comments.

If there are no material findings, say:

```text
No material findings.
```

Then list remaining verification gaps, if any.
