# Prompt / Context Caching — 2026 Audit

Internal audit of Vyotiq's cache-layered topology vs the 2026 field-tested spec.
Last verified: 2026-06-11.

## Internal message topology

```
[0]  system   — harness + <meta_rules>          (STATIC)
[1]  user     — <static_examples>               (STATIC — few-shot patterns)
[2]  user     — <workspace_context>             (SEMI-STATIC, fingerprint-gated)
[3..n-4]       — transcript history            (GROWING)
[n-2]  user   — <runtime_context>              (VOLATILE per iteration)
[n-1]  user   — <turn>                         (VOLATILE per turn)
```

Implemented in `src/main/orchestrator/context/buildContextLayers.ts`.
Few-shot body from `src/main/harness/03-static-examples.md` via `buildStaticFewShotXml()`.

## Wire fidelity per host

| Spec layer | Internal | Anthropic wire | OpenAI wire | Gemini wire |
|---|---|---|---|---|
| System + rules | `messages[0]` | Hoisted `system` + `cache_control` | `messages[0]` | `systemInstruction` part 1 |
| Few-shot | `messages[1]` | 1st user + `cache_control` | `messages[1]` | `systemInstruction` part 2 (hoisted) |
| Tool schemas | `tools[]` | Last tool + `cache_control` | `tools[]` (key-sorted) | `tools[]` or explicit cache |
| Workspace | `messages[2]` | 2nd user + `cache_control` | `messages[2]` | `systemInstruction` part 3 (hoisted) |
| History | `messages[3..n-4]` | Rolling via top-level auto | Prefix match + `prompt_cache_key` | Implicit prefix in `contents[]` |
| Runtime + turn | `messages[n-2..n-1]` | Uncached tail | Uncached tail | Uncached tail |
| DeepSeek / xAI | Same internal order | N/A (OpenAI-compat) | Automatic disk KV / `x-grok-conv-id` | N/A |

## Provider metrics mapping (2026)

| Host | Upstream field | Canonical `TokenUsage` |
|---|---|---|
| Anthropic | `usage.cache_read_input_tokens` | `cachedPromptTokens` |
| Anthropic | `usage.cache_creation_input_tokens` | `cacheCreationTokens` |
| OpenAI / xAI | `usage.prompt_tokens_details.cached_tokens` | `cachedPromptTokens` |
| OpenAI Responses | `usage.input_tokens_details.cached_tokens` | `cachedPromptTokens` |
| DeepSeek | `usage.prompt_cache_hit_tokens` | `cachedPromptTokens` |
| DeepSeek | `usage.prompt_cache_miss_tokens` | `uncachedPromptTokens` |
| Gemini | `usageMetadata.cachedContentTokenCount` | `cachedPromptTokens` |

## Cache-breaker inventory

| Source | Volatile field | Layer | Mitigation |
|---|---|---|---|
| `buildHostEnvironmentXml` | `now_utc`, `local_time` | Runtime tail (`[n-2]`) | By design — not in cached prefix |
| `run_state` / session / memory | Per-iteration refresh | Runtime tail | By design |
| Workspace listing | Directory fingerprint change | `messages[2]` | Expected invalidation when tree changes |
| `meta_rules` file edit | User preference updates | `messages[0]` | Expected; applies next iteration |
| Few-shot markdown edit | Example text change | `messages[1]` | Expected; isolated from harness |
| Tool `durationMs` | Per-call timing | `ToolResult` only | Not in transcript (`content: result.output`) |
| `ls` output | None (rel + type only) | History | Stable |
| `read` output | Line numbers in header | History | Stable for same file/range |
| `bash` stdout | Command output varies | History | Expected — semantic content |
| `toolResultCache` banner | `[cache]` prefix + hit count on repeat | History | Intentional; elapsed-time removed (was volatile) |
| `normalizeWireTools` | Key order drift | Wire tools | `stableStringify` sort |
| `toolResultCache` local `stableStringify` | Shallow vs deep sort | Cache keys | Consolidated to shared module |
| `buildSystemPrompt` (removed) | Merged all layers | N/A | Deleted — production uses `applyCacheLayers` only |
| Iteration-cap wrap-up | Synthesis instruction | Turn slot (`[n-1]`) | Merged into turn content — never a 6th user message |
| Anthropic `metadata.user_id` | Workspace id | Request metadata | Stable per workspace (isolation) |

## Manual multi-turn validation checklist

Run with a 5+ turn agent session on a workspace with ≥2k tokens of harness + workspace context.

1. **Anthropic** — set `VYOTIQ_CACHE_DIAGNOSTICS=1`. From turn 2, logs show `cacheRead > 0`; diagnostics report no `cache_miss_reason` on stable turns.
2. **OpenAI GPT-5** — `cached_tokens > 0` in `llm turn usage` log from turn 2.
3. **DeepSeek** — `prompt_cache_hit_tokens` normalized to `cacheRead > 0` from turn 2.
4. **Gemini 2.5** — `cachedContentTokenCount > 0` from turn 2; optional `VYOTIQ_GEMINI_EXPLICIT_CACHE=1` for guaranteed explicit cache on large static prefix.

## Dev environment variables

| Variable | Effect |
|---|---|
| `VYOTIQ_CACHE_DIAGNOSTICS=1` | Anthropic cache-diagnostics beta (`cache-diagnosis-2026-04-07`) — overrides settings when set |
| `VYOTIQ_GEMINI_EXPLICIT_CACHE=1` | Gemini explicit `cachedContents` — overrides settings when set |
| `VYOTIQ_LOG_LEVEL=debug` | Also enables Anthropic cache diagnostics |

Settings → Agent behavior → Prompt caching mirrors the first two flags (`settings.ui.promptCaching`).

## Spec compliance matrix (2026 field-tested)

| Spec requirement | Status | Notes |
|---|---|---|
| Static system → few-shot → workspace → history → dynamic tail | **Pass** | Six-slot topology; history via `insertHistoryBeforeTail` |
| Tool schemas key-sorted / deterministic JSON | **Pass** | `stableStringify` + `normalizeWireTools` |
| No timestamps in cached prefix | **Pass** | `now_utc` / `local_time` only in runtime tail |
| Few-shot coding examples (layer 3) | **Pass** | Dedicated `messages[1]` `<static_examples>` slot |
| Anthropic explicit breakpoints (≤4) + automatic rolling | **Pass** | System, few-shot, workspace, last tool; top-level auto for history |
| Anthropic workspace isolation | **Pass** | `metadata.user_id = workspaceId` (Feb 2026 API) |
| Anthropic 1h ephemeral TTL (default) | **Pass** | Settings `anthropicCacheTtl`; 5m optional |
| OpenAI automatic prefix + `prompt_cache_key` | **Pass** | `workspaceId:conversationId`; GPT-5 `24h` retention |
| DeepSeek automatic disk KV | **Pass** | `prompt_cache_hit_tokens` → `cachedPromptTokens` |
| Gemini implicit + optional explicit cache | **Pass** | Hoist + settings/env explicit `cachedContents` |
| Cache metrics in usage / UI | **Pass** | `TokenUsage` + run-complete + composer strip |
| Anti-pattern guards (UUIDs, volatile tool metadata in prefix) | **Partial** | Documented breakers; bash output still volatile by design |

## Pricing multiplier verification (2026)

Fallback rates in `cachePricingDefaults.ts` when discovery omits cache-read pricing:

| Host / family | Multiplier | Spec reference |
|---|---|---|
| Anthropic, DeepSeek, GPT-5 / o3 / o4 | 0.1× input (90% off) | Anthropic + DeepSeek docs |
| GPT-4.1, Gemini implicit | 0.25× input (75% off) | OpenAI cookbook / Gemini implicit |
| GPT-4o | 0.5× input (50% off) | OpenAI prompt caching guide |
| Anthropic cache write | 1.25× input | 5-min ephemeral write surcharge |
| Gemini explicit (when used) | 0.1× via discovery or 0.25× fallback | 90% on 2.5+ explicit per Google docs |

## Intentional deviations

- **Runtime tail volatility** — `run_state`, session, memory refresh every iteration by design.
- **`toolResultCache` `[cache]` banner** — intentional on repeat tool hits; invalidates history prefix.
- **No explicit Anthropic history breakpoint** — four explicit slots reserved for system, few-shot, workspace, tools; rolling history uses top-level automatic caching.
- **Groq / Mistral / Together** — automatic provider-side caching only; no explicit wire hints.
- **Ollama native** — no `cachedPromptTokens` on the wire; composer cache warning and run-loop cache-miss logs are suppressed (`providerDialectReportsPromptCache`). Models such as `gemma4:31b` are Google Gemma weights hosted on Ollama, not the Gemini API — the composer cache strip prefixes the provider name (e.g. “Ollama Cloud”) when cache metrics are shown for cache-capable dialects.
