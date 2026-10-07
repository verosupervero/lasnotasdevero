# Repository instructions for Codex

This repository is a Hugo website. Treat it as both a software project and an editorial archive.

## Core principles

1. Understand the existing implementation before editing it.
2. Prefer the smallest change that satisfies the request.
3. Reuse existing templates, partials, shortcodes, CSS patterns, data files, and frontmatter conventions.
4. Do not refactor unrelated code while implementing a feature or fixing a bug.
5. Do not rewrite article prose, metadata, or URLs unless the task requires it.
6. Do not stage, commit, push, reset, or rewrite Git history unless explicitly requested.
7. Do not delete generated or content files merely to make a build pass.
8. When repository reality conflicts with these instructions, report the conflict and preserve existing behavior until it is understood.

## Hugo structure

Do not assume every directory below exists. Discover the real structure first.

Common areas include:

- `content/` — Markdown content and frontmatter.
- `layouts/` — page templates, list templates, partials, shortcodes.
- `assets/` — Hugo Pipes resources such as CSS, JS, images.
- `static/` — files copied directly to the built site.
- `data/` — structured site data.
- `i18n/` — translations.
- `config.*`, `hugo.*`, or `config/` — Hugo configuration.
- `themes/` — theme code when used.
- `public/` — generated build output; never treat it as source unless the repository explicitly does so.

Follow Hugo's template lookup and inheritance rather than duplicating markup in multiple templates.

## Frontmatter convention: featured

For article/content frontmatter, use this semantic convention unless the repository already contains a more specific implementation:

- missing `featured` => treat as `0`
- `featured: 0` => normal article
- `featured: 1` => secondary featured candidate
- `featured: 2` => primary featured candidate

`featured` represents editorial priority, not publication order.

Do not automatically assign `featured` values to every article. Missing remains equivalent to `0`.

If multiple pieces have the same featured priority, preserve or discover the repository's tie-break behavior. Prefer a deterministic secondary sort such as publication date only when the requested feature requires it.

## Delegation policy

Use focused subagents instead of making every agent do everything.

### code-mapper

Use first when the location or execution path of a feature is not already known.

Expected result:
- relevant files;
- entry point;
- data flow;
- template/partial relationships;
- styles/scripts involved;
- uncertainties.

It must not edit files.

### implementer

Use only after the desired behavior and relevant code path are sufficiently clear.

Expected result:
- smallest viable patch;
- brief explanation of changed files;
- no unrelated refactors.

### reviewer

Use after implementation.

Expected result:
- correctness/regression findings;
- missing edge cases;
- accidental scope changes;
- file/line references when possible.

It must not edit files.

### verifier

Use after implementation/review to run the relevant Hugo build/checks and inspect generated behavior.

It may create build/cache output but must not modify source files to make verification succeed.

### docs-researcher

Use when the task depends on uncertain or version-sensitive Hugo behavior.

Prefer:
1. official Hugo documentation;
2. official release notes/source where needed;
3. authoritative upstream documentation for a library/tool;
4. secondary sources only when primary sources do not answer the question.

It must distinguish documented fact from inference.

## Skills

Use the relevant skill when the task matches it:

- `$map-hugo-codebase`
- `$plan-hugo-change`
- `$implement-hugo-change`
- `$debug-hugo-issue`
- `$verify-hugo-change`
- `$review-hugo-change`
- `$edit-hugo-content`

Do not load every skill by default. Use only what the current task needs.

## Preferred workflow: normal feature

1. Map the existing behavior.
2. Plan the smallest coherent change.
3. Implement it.
4. Review the diff.
5. Verify the result.
6. Report what changed and any remaining uncertainty.

## Preferred workflow: bug

1. Reproduce or establish the failure precisely.
2. Trace the responsible code path.
3. Form a root-cause hypothesis.
4. Test the hypothesis.
5. Implement the smallest fix.
6. Review for regressions.
7. Verify.

Do not use "change things until it works" debugging.

## Build and verification

Discover repository-specific commands first from README, scripts, CI, package metadata, or existing tooling.

When no repository-specific command exists, typical Hugo checks are:

```bash
hugo
```

or, only when appropriate for the repository:

```bash
hugo --gc --minify
```

Do not silently introduce a new build system or package dependency just to verify a small Hugo change.

## Output expectations

When reporting work, keep it concrete:

- what behavior was requested;
- what files were relevant;
- what was changed;
- what was verified;
- any remaining risk or uncertainty.

Avoid generic commentary and style-only suggestions.
