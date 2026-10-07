---
name: plan-hugo-change
description: Turn a Hugo codebase map or bug diagnosis into a minimal implementation plan. Use after exploration and before editing when a change touches templates, partials, frontmatter, CSS/JS, content selection, or multiple files.
---

# Plan a Hugo change

Create the smallest plan that completely satisfies the request.

## Inputs

Use:
- the user's requested behavior;
- code-mapper findings;
- repository conventions;
- documentation findings when relevant.

Do not re-explore the entire repository unless a required fact is missing.

## Plan format

### Objective

One or two sentences describing the externally visible result.

### Current behavior

Only the facts relevant to the change.

### Proposed change

For each source file:

```text
path
- what changes
- why it changes here
- what existing pattern is reused
```

### Explicit non-goals

List nearby things that must remain unchanged.

### Edge cases

Consider only realistic cases for this change.

For featured homepage behavior, consider:

- `featured` missing => 0;
- no priority-2 article;
- several priority-2 articles;
- fewer articles than available card slots;
- drafts/future content according to current site behavior.

### Acceptance criteria

Write observable checks, not implementation details.

Good:

- "An article without `featured` is treated as normal content."
- "A priority-2 article is eligible for the main featured slot."
- "The homepage still renders when no article has `featured`."

Bad:

- "Create a variable called `$featuredPosts`."

### Verification

Name the narrow checks needed after implementation.

## Constraints

Prefer:
- extending an existing partial over duplicating markup;
- a local template change over a global refactor;
- existing Hugo mechanisms over new JS;
- backward-compatible frontmatter behavior.

Do not turn a small feature into an architecture project.
