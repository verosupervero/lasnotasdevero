---
name: verify-hugo-change
description: Verify a Hugo change after implementation by running existing project checks, building the site, inspecting relevant generated output, and reporting PASS/FAIL. Use before declaring a coding task complete.
---

# Verify a Hugo change

Verification must test the requested behavior, not merely command exit codes.

Do not modify source files during this workflow.

## 1. Discover project commands

Check, as relevant:

- README / contributor docs;
- CI workflows;
- Makefile/task runner;
- package scripts;
- Hugo config;
- repository-specific scripts.

Prefer existing project commands over invented ones.

## 2. Inspect the diff

Know what changed before deciding what to test.

Look for:
- templates;
- frontmatter/content;
- CSS/JS/assets;
- config;
- generated files accidentally included.

## 3. Build

Run the repository's normal Hugo build.

If no custom command exists, a reasonable baseline is:

```bash
hugo
```

Use flags such as `--gc` or `--minify` only when appropriate for this repository.

Capture warnings as well as failures.

## 4. Test task-specific behavior

Examples:

### Homepage/content selection
Inspect generated homepage HTML or use repository tests to confirm:
- correct featured item;
- expected secondary cards;
- missing `featured` behaves as normal;
- no duplicates unless intended;
- layout survives too few matching items.

### Template/partial change
Inspect at least one page using the changed path.

### Content/frontmatter change
Confirm the content renders and metadata remains valid.

### CSS/JS change
Verify asset generation and, when possible, the specific selector/script path.

## 5. Check regressions narrowly

Use a few representative pages, not an exhaustive crawl unless the change warrants it.

## 6. Report

Use:

```text
RESULT: PASS | FAIL

Commands:
- ...

Verified:
- ...

Warnings / failures:
- ...

Not verified:
- ...
```

Do not hide warnings because the command returned exit code 0.
