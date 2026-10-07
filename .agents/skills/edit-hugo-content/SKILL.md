---
name: edit-hugo-content
description: Safely edit Hugo Markdown content and frontmatter without accidentally rewriting prose, URLs, metadata, or editorial intent. Use for article metadata, featured priority, descriptions, tags, categories, links, shortcodes, or content-file changes.
---

# Edit Hugo content safely

Content files are editorial source, not generic code.

## Preserve editorial intent

Unless explicitly requested, do not:
- rewrite article body prose;
- normalize the author's voice;
- change theology/claims;
- shorten or expand text;
- change title wording;
- change descriptions for SEO;
- alter tags/categories;
- change dates;
- change slugs/permalinks/aliases;
- replace links;
- reformat Markdown globally.

Make only the content edit required by the task.

## Frontmatter

Preserve the file's existing frontmatter format and ordering style when practical.

Do not convert YAML/TOML/JSON frontmatter merely for consistency.

Keep existing unknown fields intact.

## Featured convention

Use:

```text
featured missing => 0
featured: 0      => normal article
featured: 1      => secondary featured candidate
featured: 2      => primary featured candidate
```

Important:
- missing is intentionally valid;
- do not add `featured: 0` everywhere;
- `featured` is editorial priority, not a replacement for date;
- do not change an article's featured value unless the user requested that editorial decision or supplied a rule that determines it.

## Hugo syntax

Preserve:
- shortcodes;
- paired shortcode boundaries;
- Markdown attributes;
- reference links;
- internal paths;
- page bundles/resource references.

Do not "clean up" syntax you do not understand. Trace how the site uses it first.

## Bulk edits

Before a bulk content change:
1. identify the exact eligible set;
2. inspect a small sample;
3. define invariants that must remain untouched;
4. perform the narrow transformation;
5. inspect the diff for prose/metadata churn.

## Report

State exactly which metadata/body fields changed and how many content files were touched.
