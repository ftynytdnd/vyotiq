/**
 * Streaming-safe partial JSON parser.
 *
 * Built for one specific job: turn the cumulative `argumentsBuf` of an
 * in-flight tool call (assembled from OpenAI's `toolCallDelta.argumentsDelta`
 * fragments or Anthropic's `input_json_delta.partial_json` fragments) into
 * a best-effort `Record<string, unknown>` snapshot the renderer can paint
 * BEFORE the stream closes and the buffer parses to valid JSON.
 *
 * Why not just `JSON.parse`:
 *   The provider sends arbitrary mid-token cuts. `JSON.parse('{"path":"sr')`
 *   throws. We need a parser that accepts progressively longer prefixes
 *   and returns the largest valid structural projection of each prefix.
 *
 * Why a stateful class (vs re-parsing each cumulative buffer):
 *   Re-parsing from index 0 every chunk is O(n²) over the stream — the
 *   classic anti-pattern documented by aha.io/engineering/articles/
 *   streaming-ai-responses-incomplete-json. We carry `lastIndex` and
 *   resume scanning from there, giving an O(delta) cost per call.
 *
 * Contract:
 *   - `feed(cumulativeBuf)` — pass the FULL cumulative buffer each call.
 *     Returns a `Record<string, unknown>` snapshot or `null` when the
 *     buffer hasn't yet matched any object opener. Never throws.
 *   - `reset()` — wipes state so the parser can be reused for the next
 *     call (after a callId reconciliation or run abort).
 *
 * Semantics on truncation:
 *   - String mid-value → string is included with everything captured so
 *     far. `\u` escape mid-collection waits for 4 hex digits before
 *     emitting the code point.
 *   - Number mid-token (e.g. `2e-` waiting on the exponent) → KEY OMITTED
 *     from the snapshot (per the project rule: don't surface placeholder
 *     `null`/`undefined`, surface real data only).
 *   - Key without colon (e.g. `{"path"`) → key omitted.
 *   - Key with colon but no value yet (e.g. `{"path":`) → key omitted.
 *   - Genuinely malformed input that can't be re-aligned → returns the
 *     last-known-good snapshot rather than throwing.
 *
 * Limitations:
 *   - Top-level array support is implemented but not used by the current
 *     tool-args path (every tool's args is an object). Tests cover the
 *     object path comprehensively.
 *   - Numbers larger than `Number.MAX_SAFE_INTEGER` and special values
 *     (`NaN`, `Infinity`) follow `JSON.parse` semantics — we use the
 *     native parser on completed tokens.
 *   - Pure helper. No DOM, no React, no IO. Safe to import from anywhere.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

/** Sentinel: a value couldn't be fully read; wait for more bytes. */
const SENTINEL_INCOMPLETE: unique symbol = Symbol('incomplete');
type IncompleteSentinel = typeof SENTINEL_INCOMPLETE;
/** Sentinel: a `{` / `[` opened a new frame; no value to attach yet. */
const SENTINEL_PUSHED_FRAME: unique symbol = Symbol('pushed-frame');
type PushedFrameSentinel = typeof SENTINEL_PUSHED_FRAME;

/**
 * Internal frame for the structural stack. Each open `{` / `[` pushes a
 * frame; balanced closers pop it. The parser walks the buffer once,
 * building values into the top frame as tokens settle.
 */
type Frame =
  | {
    kind: 'object';
    obj: Record<string, JsonValue>;
    /** Key the parser is currently constructing (or just settled). */
    pendingKey?: string;
    /** State within the key/value cycle for this frame. */
    state: 'expect-key-or-end' | 'in-key' | 'expect-colon' | 'expect-value' | 'expect-comma-or-end';
  }
  | {
    kind: 'array';
    arr: JsonValue[];
    state: 'expect-value-or-end' | 'expect-comma-or-end';
  };

export class PartialJsonParser {
  /** Cumulative buffer fed so far. */
  private buf = '';
  /** Next index to scan inside `buf`. */
  private lastIndex = 0;
  /** Open structural frames (top-of-stack is the innermost). */
  private stack: Frame[] = [];
  /** Last-known-good snapshot. Returned when a chunk leaves the parser
   *  in an irrecoverable state. */
  private lastGood: Record<string, unknown> | null = null;
  /**
   * Checkpoint for an in-flight string read whose closing `"` hasn't
   * landed yet. Audit fix H5: without this, every truncated `readString`
   * call re-walked the entire string body from the opening quote on the
   * NEXT feed, turning the documented O(delta) cost into O(n²) over a
   * long streamed string. We now save the partially-decoded text and
   * the cursor position; the next `readString` resumes from there.
   *
   * - `out`: decoded text accumulated so far (escape sequences resolved).
   * - `cursor`: index in `buf` where the next character to scan lives
   *   (always `> lastIndex`; lastIndex still points at the opening
   *   `"` so a defensive re-entry sees the string opener).
   * - `highSurrogate`: pending high surrogate from a `\uXXXX` escape
   *   that's waiting on its paired low surrogate. Audit fix H6 — see
   *   `readString` below.
   */
  private pendingString: { out: string; cursor: number; highSurrogate: number | null } | null = null;
  /** Total characters scanned across all `feed` calls. Exposed only for
   *  the O(delta) regression test. */
  // eslint-disable-next-line @typescript-eslint/naming-convention
  __scanCount = 0;

  /** Reset all state. Used when a callId reconciles or a run aborts. */
  reset(): void {
    this.buf = '';
    this.lastIndex = 0;
    this.stack = [];
    this.lastGood = null;
    this.pendingString = null;
    this.__scanCount = 0;
  }

  /**
   * Append the cumulative buffer (latest snapshot) and return a best-
   * effort top-level object. If the prefix is the empty string or has
   * not yet matched an `{` opener, returns `null`. Never throws.
   */
  feed(cumulativeBuf: string): Record<string, unknown> | null {
    // Cumulative-buffer contract: each call must pass a string that
    // starts with whatever was passed last time. Defensive: if the new
    // buf is shorter or doesn't share the prefix, treat as a reset.
    if (cumulativeBuf.length < this.buf.length || !cumulativeBuf.startsWith(this.buf)) {
      this.reset();
    }
    this.buf = cumulativeBuf;
    try {
      this.scan();
    } catch {
      // Irrecoverable mid-buffer corruption — keep returning the last
      // good snapshot until the stream catches up to a valid prefix.
      return this.lastGood;
    }
    const snapshot = this.snapshot();
    if (snapshot !== null) {
      this.lastGood = snapshot;
    }
    return snapshot ?? this.lastGood;
  }

  /** Advance `lastIndex` to the end of the next non-whitespace token. */
  private skipWs(): void {
    while (this.lastIndex < this.buf.length) {
      const ch = this.buf.charCodeAt(this.lastIndex);
      // 0x20 space, 0x09 \t, 0x0A \n, 0x0D \r
      if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) {
        this.lastIndex++;
        this.__scanCount++;
      } else {
        return;
      }
    }
  }

  /** Main scan loop — pure walk from `lastIndex` to end-of-buffer. */
  private scan(): void {
    while (this.lastIndex < this.buf.length) {
      this.skipWs();
      if (this.lastIndex >= this.buf.length) return;

      const top = this.stack[this.stack.length - 1];

      // ----- Top-level (no open frame yet) -----
      if (!top) {
        const ch = this.buf[this.lastIndex]!;
        if (ch === '{') {
          this.stack.push({
            kind: 'object',
            obj: {},
            state: 'expect-key-or-end'
          });
          this.lastIndex++;
          this.__scanCount++;
          continue;
        }
        if (ch === '[') {
          this.stack.push({
            kind: 'array',
            arr: [],
            state: 'expect-value-or-end'
          });
          this.lastIndex++;
          this.__scanCount++;
          continue;
        }
        // Anything else at top level (e.g. a bare number) — not a
        // tool-args shape; bail.
        return;
      }

      // ----- Inside an object frame -----
      if (top.kind === 'object') {
        const ch = this.buf[this.lastIndex]!;

        if (top.state === 'expect-key-or-end' || top.state === 'expect-comma-or-end') {
          if (ch === '}') {
            this.lastIndex++;
            this.__scanCount++;
            this.popFrame(top);
            continue;
          }
          if (top.state === 'expect-comma-or-end' && ch === ',') {
            this.lastIndex++;
            this.__scanCount++;
            top.state = 'expect-key-or-end';
            continue;
          }
          if (top.state === 'expect-key-or-end' && ch === '"') {
            const keyResult = this.readString();
            if (keyResult === null) return; // truncated key; bail until more bytes
            top.pendingKey = keyResult;
            top.state = 'expect-colon';
            continue;
          }
          // Whitespace already skipped; anything else is malformed
          // (or premature end). Wait for more bytes.
          return;
        }

        if (top.state === 'expect-colon') {
          if (ch === ':') {
            this.lastIndex++;
            this.__scanCount++;
            top.state = 'expect-value';
            continue;
          }
          return; // wait for the colon
        }

        if (top.state === 'expect-value') {
          const value = this.readValue();
          if (value === SENTINEL_INCOMPLETE) return;
          if (value === SENTINEL_PUSHED_FRAME) {
            // A nested {/[ opened a new frame; the value will be
            // attached to top.pendingKey when that frame closes.
            continue;
          }
          if (top.pendingKey !== undefined) {
            top.obj[top.pendingKey] = value as JsonValue;
            top.pendingKey = undefined;
          }
          top.state = 'expect-comma-or-end';
          continue;
        }
      }

      // ----- Inside an array frame -----
      if (top.kind === 'array') {
        const ch = this.buf[this.lastIndex]!;

        if (top.state === 'expect-value-or-end') {
          if (ch === ']') {
            this.lastIndex++;
            this.__scanCount++;
            this.popFrame(top);
            continue;
          }
          const value = this.readValue();
          if (value === SENTINEL_INCOMPLETE) return;
          if (value === SENTINEL_PUSHED_FRAME) continue;
          top.arr.push(value as JsonValue);
          top.state = 'expect-comma-or-end';
          continue;
        }

        if (top.state === 'expect-comma-or-end') {
          if (ch === ']') {
            this.lastIndex++;
            this.__scanCount++;
            this.popFrame(top);
            continue;
          }
          if (ch === ',') {
            this.lastIndex++;
            this.__scanCount++;
            top.state = 'expect-value-or-end';
            continue;
          }
          return;
        }
      }
    }
  }

  /**
   * Pop the top frame and attach its built value to the parent (or
   * commit it as `lastGood` when the root closes — without this the
   * snapshot would vanish the moment the JSON parses to completion,
   * since `snapshot()` reads from `this.stack[0]`).
   */
  private popFrame(top: Frame): void {
    this.stack.pop();
    const value: JsonValue = top.kind === 'object' ? top.obj : top.arr;
    const parent = this.stack[this.stack.length - 1];
    if (!parent) {
      // Root closed — commit it. Only objects are surfaced through
      // `lastGood` (callers expect `Record<string, unknown> | null`);
      // a top-level array close clears state for the next feed.
      if (top.kind === 'object') {
        this.lastGood = snapshotObject(top.obj);
      }
      return;
    }
    if (parent.kind === 'object' && parent.pendingKey !== undefined) {
      parent.obj[parent.pendingKey] = value;
      parent.pendingKey = undefined;
      parent.state = 'expect-comma-or-end';
    } else if (parent.kind === 'array') {
      parent.arr.push(value);
      parent.state = 'expect-comma-or-end';
    }
  }

  /**
   * Read a full string starting at the current `"`. Returns the
   * decoded string and advances `lastIndex` past the closing quote.
   * Returns `null` when the string is truncated mid-content (caller
   * must wait for more bytes).
   *
   * O(delta) per call across the lifetime of one streaming string:
   * the checkpoint at `pendingString` lets a truncated read resume
   * from where it left off on the next `feed()`. Audit fix H5 — the
   * pre-fix implementation walked from `lastIndex + 1` every time,
   * giving O(n²) total work for an n-byte streamed string.
   *
   * Surrogate pairs (`\uD83D\uDE80` → 🚀): handled by combining the
   * pair via `String.fromCodePoint` before appending, matching
   * `JSON.parse` semantics. A high surrogate at the end of the
   * buffer is held on `pendingString.highSurrogate` until the
   * matching low surrogate's escape arrives. Audit fix H6.
   */
  private readString(): string | null {
    // Caller asserts buf[lastIndex] === '"'.
    let i: number;
    let out: string;
    let highSurrogate: number | null;
    if (this.pendingString) {
      // Resume from the checkpoint. The opening quote was consumed
      // logically; we already accumulated `out` from that boundary.
      i = this.pendingString.cursor;
      out = this.pendingString.out;
      highSurrogate = this.pendingString.highSurrogate;
    } else {
      i = this.lastIndex + 1;
      out = '';
      highSurrogate = null;
    }
    const startScan = i;
    while (i < this.buf.length) {
      const ch = this.buf[i]!;
      if (ch === '\\') {
        // Need at least one more char.
        if (i + 1 >= this.buf.length) {
          this.__scanCount += i - startScan;
          this.pendingString = { out, cursor: i, highSurrogate };
          return null;
        }
        const esc = this.buf[i + 1]!;
        switch (esc) {
          case '"': out += '"'; i += 2; highSurrogate = null; break;
          case '\\': out += '\\'; i += 2; highSurrogate = null; break;
          case '/': out += '/'; i += 2; highSurrogate = null; break;
          case 'b': out += '\b'; i += 2; highSurrogate = null; break;
          case 'f': out += '\f'; i += 2; highSurrogate = null; break;
          case 'n': out += '\n'; i += 2; highSurrogate = null; break;
          case 'r': out += '\r'; i += 2; highSurrogate = null; break;
          case 't': out += '\t'; i += 2; highSurrogate = null; break;
          case 'u': {
            if (i + 6 > this.buf.length) {
              // Wait for 4 hex digits.
              this.__scanCount += i - startScan;
              this.pendingString = { out, cursor: i, highSurrogate };
              return null;
            }
            const hex = this.buf.slice(i + 2, i + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw new Error('invalid \\u escape');
            }
            const cu = parseInt(hex, 16);
            if (cu >= 0xd800 && cu <= 0xdbff) {
              // High surrogate. Hold it until the paired low surrogate
              // arrives (audit fix H6). The low surrogate ALWAYS comes
              // as a `\uXXXX` escape in valid JSON; if instead the
              // next code unit isn't a low surrogate we emit the high
              // surrogate as a lone code unit (matches JSON.parse).
              highSurrogate = cu;
              i += 6;
              break;
            }
            if (cu >= 0xdc00 && cu <= 0xdfff && highSurrogate !== null) {
              // Low surrogate following a held high surrogate — combine.
              out += String.fromCodePoint(
                ((highSurrogate - 0xd800) << 10) + (cu - 0xdc00) + 0x10000
              );
              highSurrogate = null;
              i += 6;
              break;
            }
            // Either a lone low surrogate, or a BMP code point after a
            // held high surrogate (which must therefore be emitted
            // standalone). Flush the held high (if any) then this code
            // point.
            if (highSurrogate !== null) {
              out += String.fromCharCode(highSurrogate);
              highSurrogate = null;
            }
            out += String.fromCharCode(cu);
            i += 6;
            break;
          }
          default:
            throw new Error(`invalid escape \\${esc}`);
        }
        continue;
      }
      if (ch === '"') {
        // Closing quote. Flush any held high surrogate (lone). Clear
        // the checkpoint and advance lastIndex past the closer.
        if (highSurrogate !== null) {
          out += String.fromCharCode(highSurrogate);
        }
        this.__scanCount += i - startScan + 1;
        this.lastIndex = i + 1;
        this.pendingString = null;
        return out;
      }
      // Plain character. A BMP literal after a held high surrogate
      // means the held surrogate stays lone — flush it first.
      if (highSurrogate !== null) {
        out += String.fromCharCode(highSurrogate);
        highSurrogate = null;
      }
      out += ch;
      i++;
    }
    // Ran off the end without a closing quote — truncated string.
    // Save the checkpoint so the next `feed()` resumes here instead
    // of re-walking from `lastIndex + 1`.
    this.__scanCount += i - startScan;
    this.pendingString = { out, cursor: i, highSurrogate };
    return null;
  }

  /**
   * Read a single value (string, number, boolean, null, object, array)
   * starting at the current `lastIndex`. Whitespace must already be
   * skipped. Returns:
   *   - the parsed `JsonValue` on success
   *   - `SENTINEL_INCOMPLETE` when more bytes are needed
   *   - `SENTINEL_PUSHED_FRAME` when an open brace/bracket pushed a
   *     new frame and the value will materialize when it closes
   */
  private readValue(): JsonValue | IncompleteSentinel | PushedFrameSentinel {
    const ch = this.buf[this.lastIndex]!;
    if (ch === '"') {
      const s = this.readString();
      if (s === null) return SENTINEL_INCOMPLETE;
      return s;
    }
    if (ch === '{') {
      this.stack.push({
        kind: 'object',
        obj: {},
        state: 'expect-key-or-end'
      });
      this.lastIndex++;
      this.__scanCount++;
      return SENTINEL_PUSHED_FRAME;
    }
    if (ch === '[') {
      this.stack.push({
        kind: 'array',
        arr: [],
        state: 'expect-value-or-end'
      });
      this.lastIndex++;
      this.__scanCount++;
      return SENTINEL_PUSHED_FRAME;
    }
    if (ch === 't' || ch === 'f' || ch === 'n') {
      return this.readKeyword();
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      return this.readNumber();
    }
    // Unknown lead char — wait (most likely whitespace before a
    // future value, already handled, so this is malformed).
    throw new Error(`unexpected char ${JSON.stringify(ch)}`);
  }

  /** Read `true` / `false` / `null`. Truncated → INCOMPLETE. */
  private readKeyword(): boolean | null | IncompleteSentinel {
    if (this.buf.startsWith('true', this.lastIndex)) {
      this.lastIndex += 4;
      this.__scanCount += 4;
      return true;
    }
    if (this.buf.startsWith('false', this.lastIndex)) {
      this.lastIndex += 5;
      this.__scanCount += 5;
      return false;
    }
    if (this.buf.startsWith('null', this.lastIndex)) {
      this.lastIndex += 4;
      this.__scanCount += 4;
      return null;
    }
    // Could still be a partial keyword (e.g. "tr"); wait.
    const rem = this.buf.slice(this.lastIndex);
    if ('true'.startsWith(rem) || 'false'.startsWith(rem) || 'null'.startsWith(rem)) {
      return SENTINEL_INCOMPLETE;
    }
    throw new Error(`unknown keyword at ${this.lastIndex}`);
  }

  /**
   * Read a JSON number. We scan to the first non-numeric char then
   * call `Number(s)`. If we hit end-of-buffer we treat it as INCOMPLETE
   * because the next chunk might add more digits / exponent.
   */
  private readNumber(): number | IncompleteSentinel {
    let i = this.lastIndex;
    const start = i;
    if (this.buf[i] === '-') i++;
    while (i < this.buf.length && this.buf[i]! >= '0' && this.buf[i]! <= '9') i++;
    if (i < this.buf.length && this.buf[i] === '.') {
      i++;
      while (i < this.buf.length && this.buf[i]! >= '0' && this.buf[i]! <= '9') i++;
    }
    if (i < this.buf.length && (this.buf[i] === 'e' || this.buf[i] === 'E')) {
      i++;
      if (i < this.buf.length && (this.buf[i] === '+' || this.buf[i] === '-')) i++;
      while (i < this.buf.length && this.buf[i]! >= '0' && this.buf[i]! <= '9') i++;
    }
    if (i >= this.buf.length) {
      // Ran off the end — number might still grow. Wait.
      return SENTINEL_INCOMPLETE;
    }
    const tok = this.buf.slice(start, i);
    const n = Number(tok);
    if (Number.isNaN(n)) throw new Error(`invalid number ${tok}`);
    this.__scanCount += i - start;
    this.lastIndex = i;
    return n;
  }

  /**
   * Build an immutable snapshot of the structural state — a deep
   * (structurally) plain copy of the root object's settled keys. Keys
   * whose values are still in-flight (truncated string, pending value)
   * are omitted per the contract on this module.
   */
  private snapshot(): Record<string, unknown> | null {
    const root = this.stack[0];
    if (!root || root.kind !== 'object') return null;
    return snapshotObject(root.obj);
  }
}

/**
 * Deep copy of the partial object's settled portion. Pure clone — no
 * shared references with the parser's internal frames so callers can
 * pass the result through React state without risking later mutation
 * if the parser appends to the same frame on the next chunk.
 */
function snapshotObject(obj: Record<string, JsonValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    out[k] = snapshotValue(obj[k]!);
  }
  return out;
}

function snapshotValue(v: JsonValue): unknown {
  if (v === null) return null;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(snapshotValue);
  return snapshotObject(v as Record<string, JsonValue>);
}

/**
 * One-shot convenience — instantiate a fresh parser, feed the whole
 * buffer, return the snapshot. Use this for tests and for
 * non-performance-critical paths (e.g. a unit test fixture). Real
 * streaming consumers should keep a long-lived `PartialJsonParser`
 * per callId to retain the O(delta) cost guarantee.
 */
export function safeParsePartial(buf: string): Record<string, unknown> | null {
  if (!buf) return null;
  const p = new PartialJsonParser();
  return p.feed(buf);
}
