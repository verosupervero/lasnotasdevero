# Codex agents + skills for a Hugo site

This package is meant to be copied into the root of a Hugo repository.

## Included

- `AGENTS.md`: repository-wide operating rules and delegation policy.
- `.codex/config.toml`: subagent concurrency/depth settings.
- `.codex/agents/*.toml`: five project-scoped custom subagents.
- `.agents/skills/*/SKILL.md`: seven reusable Hugo workflows.

## Agents

| Agent | Purpose | Writes source files? |
|---|---|---|
| `code-mapper` | Locate the code path responsible for a requested behavior | No |
| `implementer` | Implement the smallest justified change | Yes |
| `reviewer` | Review the completed diff for bugs/regressions | No |
| `verifier` | Build/test/inspect generated output | No source edits |
| `docs-researcher` | Verify Hugo/API behavior against authoritative docs | No |

## Recommended flow

For a normal feature:

1. `code-mapper`
2. root agent uses `plan-hugo-change`
3. `implementer`
4. `reviewer`
5. `verifier`

For a bug:

1. root agent uses `debug-hugo-issue`
2. `code-mapper` if the path is not obvious
3. `implementer`
4. `reviewer`
5. `verifier`

For a question about Hugo behavior:

1. `docs-researcher`
2. `code-mapper` if repository-specific behavior also matters
3. plan/implement only after the expected behavior is established

## Installation

Copy the contents of this folder into the root of the Hugo repository.

The final repository should contain:

```text
AGENTS.md
.codex/
  config.toml
  agents/
    code-mapper.toml
    implementer.toml
    reviewer.toml
    verifier.toml
    docs-researcher.toml
.agents/
  skills/
    map-hugo-codebase/SKILL.md
    plan-hugo-change/SKILL.md
    implement-hugo-change/SKILL.md
    debug-hugo-issue/SKILL.md
    verify-hugo-change/SKILL.md
    review-hugo-change/SKILL.md
    edit-hugo-content/SKILL.md
```

Start Codex from the repository root so project-scoped configuration is visible.

## Notes

The package deliberately avoids pinning a model. Custom agents inherit the parent session's model and reasoning configuration unless you later decide to override them.

The `verifier` has workspace-write access because Hugo may need to create build output or cache files. Its instructions explicitly forbid modifying source files.
