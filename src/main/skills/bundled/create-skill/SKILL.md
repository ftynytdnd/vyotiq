---
name: create-skill
description: Interactive workflow to author a new Agent Skill at .vyotiq/skills/<name>/SKILL.md. Invoke via /create-skill when the user wants to add a reusable workflow.
disable-model-invocation: true
---

# Create Agent Skill

Walk the user through authoring a workspace skill. Skills are folders with a `SKILL.md` file (Agent Skills open standard).

## Workflow

1. **Clarify intent** — Ask what the skill should do and when Agent V should load it automatically vs manual `/skill-name` only.
2. **Choose a name** — Lowercase letters, numbers, hyphens only (`deploy-app`, `code-review`). Must match the parent folder name. Max 64 characters.
3. **Write description** — One line for the skills catalogue: what it does + when to use it (keywords help auto-detection).
4. **Create the file** — Use `edit` to create `.vyotiq/skills/<name>/SKILL.md`:

```markdown
---
name: <name>
description: <when and why to load this skill>
---

# <Title>

## When to use

- …

## Instructions

- Step-by-step guidance for the agent.
```

5. **Optional `references/`** — Large docs can live beside SKILL.md; instruct the agent to `read` them on demand (tier-3 attachments are not auto-loaded).
6. **Manual-only skills** — Add `disable-model-invocation: true` to frontmatter when the skill should only run via `/skill-name` (slash commands, migrations).
7. **Path scoping** — Optional `paths:` globs limit when the skill appears in the catalogue (model self-filters using open files).
8. **Confirm** — Tell the user they can invoke with `/name`, browse in Settings → Agent behavior → Skills, or ask you to load it via `context action="load"`.

## Rules

- Workspace skills live at `.vyotiq/skills/<name>/SKILL.md` (preferred over `.cursor/skills/` for Vyotiq-native skills).
- Folder name must match `name` in frontmatter.
- Do not create placeholder-only bodies — write real instructions.
- If a workspace skill named `create-skill` already exists, it overrides this built-in skill.
