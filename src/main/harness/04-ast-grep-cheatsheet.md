# ast-grep Quick Reference (cache-stable)



Bundled ast-grep v0.43+ guidance for Agent V. Official docs: https://ast-grep.github.io/



## Metavariables



| Token | Matches |

|-------|---------|

| `$NAME` | One AST node (`$META`, `$A`, `$_` valid; `$invalid` not) |

| `$$$ARGS` | Zero or more nodes (args, params, statements) |

| `$$OP` | Unnamed node (punctuation) |

| `$_NAME` | Non-capturing (faster — no HashMap) |



Patterns must be **valid code** tree-sitter can parse — not grep regex (`.*`, `|`).



## `search` tool (read-only)



```json

{ "name": "search", "arguments": { "query": "MyClass", "glob": "**/*.py" } }

{ "name": "search", "arguments": { "pattern": "class $NAME", "glob": "**/*.py", "language": "python" } }

{ "name": "search", "arguments": { "kind": "function_declaration", "glob": "**/*.ts", "query": "functions" } }

```



- Grep-style queries auto-fallback to line regex; host adds hints on zero hits.

- Zero-hit AST patterns include `--debug-query` parse diagnostics in tool output.

- Prefix names (`use$HOOK`) are invalid — use constraints in YAML (see below).



## `sg` tool (rewrite / lint / test)



```json

{ "name": "sg", "arguments": { "action": "run", "pattern": "$A && $A()", "rewrite": "$A?.()", "language": "typescript" } }

{ "name": "sg", "arguments": { "action": "scan", "rulePath": "rules/no-console.yml", "path": "src" } }

{ "name": "sg", "arguments": { "action": "scan", "configPath": "sgconfig.yml" } }

{ "name": "sg", "arguments": { "action": "test", "configPath": "sgconfig.yml" } }

```



- `apply: true` → `--update-all` (disk writes). Confirm with user first.

- Scaffold in workspace: `ast-grep new` → `sgconfig.yml`, `rules/`, `rule-tests/`.



## YAML rule essentials



```yaml

id: my-rule

language: TypeScript

rule:

  pattern: $HOOK($$$ARGS)

constraints:

  HOOK: { regex: '^use' }

```



**Pattern object** (ambiguous fragments):



```yaml

rule:

  pattern:

    context: 'class A { a = 123 }'

    selector: field_definition

```



**Relational** (order matters — use `all:` when debugging):



```yaml

rule:

  all:

    - pattern: function $F() { $$$ }

    - has:

        pattern: $F()

        stopBy: end

```



## Common node kinds (use with `kind` arg)



| Language | Examples |

|----------|----------|

| Python | `function_definition`, `class_definition`, `import_statement` |

| TypeScript | `function_declaration`, `class_declaration`, `export_statement` |

| Go | `function_declaration`, `import_spec` |



Discover more: tree-sitter `node-types.json` for each grammar.



## Performance notes



- CLI: parallel Rust; bundled binary on agent `bash` PATH.

- napi langs (TS/JS/TSX/HTML/CSS): in-process `findInFiles` — prefer over per-file parse in JS.



## Limits



- No type/flow/taint analysis — structural match only.

- One language per YAML rule; use `languageGlobs` in `sgconfig.yml` to map extensions.

- ast-grep is not a sandbox — `apply` and rewrites change files on disk.


