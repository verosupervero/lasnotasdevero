---
name: debug-hugo-issue
description: Diagnose Hugo build, template, content, CSS/JS, routing, or rendering bugs by establishing root cause before editing. Use when something is broken, inconsistent, missing, or unexpectedly rendered.
---

# Debug a Hugo issue systematically

Do not start by editing likely-looking files.

## 1. State the failure

Capture:

- expected behavior;
- actual behavior;
- affected page/build command;
- error/warning text if any;
- whether it is deterministic.

## 2. Reproduce or establish evidence

Use the smallest reliable reproduction available.

Examples:
- run the existing build command;
- inspect one affected page;
- compare one working content item with one broken item;
- inspect generated HTML;
- trace one template path.

Do not change source just to create a cleaner reproduction.

## 3. Localize the layer

Classify the likely failure:

- content/frontmatter;
- Hugo config;
- template lookup;
- partial/shortcode;
- data;
- CSS;
- JavaScript;
- asset pipeline;
- theme/module override;
- deployment/environment.

This classification is provisional until supported by evidence.

## 4. Trace the responsible path

Use `$map-hugo-codebase` when the path is not obvious.

Follow the actual data and rendering flow.

## 5. Compare against a known-good case

When possible, compare:
- working vs broken content;
- working vs broken template branch;
- before vs after diff;
- documented Hugo behavior vs repository behavior.

Find the smallest meaningful difference.

## 6. Form a root-cause hypothesis

Write it as a falsifiable sentence:

```text
The page fails because X causes Y at Z.
```

Then identify what observation would disprove it.

## 7. Test the hypothesis

Use inspection or the narrowest command possible.

If disproved, form a new hypothesis.

Do not accumulate speculative fixes.

## 8. Fix only after cause is supported

When authorized to edit, use `$implement-hugo-change`.

When operating in a read-only context, return:
- root cause;
- evidence;
- exact fix location;
- recommended minimal change.

## 9. Verify the original failure

A fix is complete only if the original failing behavior is checked again.
