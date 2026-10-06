# Reference

[Back to README](../README.md)

## Result semantics

Every input must be satisfied: a positive pattern must match, and a pattern with a leading `!` must not match. The output has two deduplicated, brace-expanded groups:

- `include`: match **any** pattern in this group (OR).
- `exclude`: match **any** pattern in this group (OR) to exclude a path. The leading negation operator has been removed.

A path matches the result if it matches `include` and does not match `exclude`. With a compatible `match(pattern, path)` function:

```ts
const { include, exclude } = distribute(['**/*.ts', '!**/*.test.ts'])
const accepted = include.some(pattern => match(pattern, path))
  && !exclude.some(pattern => match(pattern, path))
```

Both fields are always present. Empty `include` matches nothing; empty `exclude` excludes nothing. An impossible intersection returns `{ include: [], exclude: [] }`. An empty input matches everything and returns `{ include: ['**'], exclude: [] }`. An empty pattern matches only the empty string, so `distribute([''])` returns `{ include: [''], exclude: [] }`.

Exclusions are normalized and kept separately because a glob complement is not generally expressible as positive glob alternatives. Includes fully covered by an exclusion are dropped, as are exclusions that cannot overlap any remaining include. Repeated leading `!` toggles, so `!!a` is a positive `a`. Only the negation operator is removed: literal exclamation marks stay escaped, and negated character classes keep their meaning. For example, `distribute(['*', '!{!abc}'])` returns `{ include: ['*'], exclude: ['\\!abc'] }`, excluding the literal filename `!abc`.

Inputs are not mutated. Alternatives can overlap and are not guaranteed to be minimal or sorted. No filesystem access occurs.

## Glob dialect

Patterns follow [fast-glob](https://github.com/oxc-project/fast-glob), the Rust matcher used by Oxc, which shares the common globstar dialect:

| Syntax                 | Meaning                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `*`                    | Zero or more characters within a path segment                    |
| `**`                   | As a whole segment, zero or more segments; otherwise same as `*` |
| `?`                    | Exactly one UTF-8 byte except `/`                                |
| `[ab]`, `[a-z]`        | One byte from the set, except `/`; `[!ab]` or `[^ab]` negates    |
| `{a,b}`                | Alternatives; nesting and empty branches are supported           |
| `\*`, `\?`, `\{`, etc. | A literal escaped character                                      |
| `!pattern`             | Negation at the start; literal elsewhere                         |

A path is a sequence of `/`-separated segments. `**/file` matches `file`, `a/file`, and `a/b/file`, and `a/**/b` matches `a/b`. A trailing `**` needs at least one segment: `a/**` matches `a/` and everything below it, but not `a`. Elsewhere `**` is a single-segment wildcard, so `a**b` is normalized to `a*b`. Matching is case-sensitive and wildcards include dotfiles and newlines. Backslashes escape characters and are not Windows separators. A trailing slash is significant: `a/` matches only `a/`.

Character classes follow fast-glob: the first member is literal even when it is `]`, a `-` that is first, last, or escaped is literal, and `/` never matches, so `[!/]` is `?`. ASCII classes in the output are canonical: a one-member class becomes an escaped literal, members are sorted and merged, and a class that can match nothing drops its alternative.

Matching follows fast-glob on UTF-8 path strings: `?` and classes consume one byte, so `??` matches `é` and `????` matches `🌟`. Class members and range endpoints are also interpreted as bytes. Outputs remain valid Unicode strings; byte constraints that cut through a Unicode character may require larger character classes or multiple alternatives.

Extglobs are not a separate syntax: parentheses are literal characters, as are unmatched `]` and `}` and non-leading `!`. Unclosed classes, unclosed braces, dangling escapes, and more than 10 brace groups or nesting levels throw `SyntaxError`, following fast-glob’s `validate` limits. Braces group alternatives only, so `{a}` matches `a` and range notation is not expanded (`{1..3}` matches the literal text `1..3`). Escape opening braces to match them literally. The escapes `\n`, `\r`, `\t`, and `\b` match newline, carriage return, tab, and backspace; other escapes quote the next byte.

Globstar recognition preserves fast-glob’s original brace and escape boundaries: for example, `*{*}/b` remains a single-segment wildcard and `**\/b` does not become recursive. A brace branch can start a recursive wildcard inside a segment, so `a{**}/b` expands to `ab` and `a*/**/b`.

Known implementation difference: fast-glob 1.1.2 commits earlier wildcard backtracking when it enters a brace globstar. For example, it does not match `*a{**}/` against `aa`, or `*{**}/` against `a`. This library keeps the wildcard language semantics and matches both. These upstream backtracking artifacts are deliberately not part of the compatibility target; character, escape, and globstar recognition still follow fast-glob. Ordinary glob patterns and the compatibility fixtures are checked against the upstream matcher.

Outputs are globs in the same dialect, so fast-glob and matchers with the same semantics consume them directly. The test suite checks the semantics against verdicts recorded from fast-glob itself.

## Limits

Intersections may require exponentially many alternatives. Limits apply to the entire call, including brace expansion and intermediate results. `maxResults` also bounds the combined number of final `include` and `exclude` entries. Exceeded limits throw `RangeError` rather than return incomplete output.

```ts
distribute(patterns, {
  maxResults: 10_000,
  maxOperations: 100_000,
})
```

Both limits must be positive safe integers. There is no fixed input length limit; a nontrivial pairwise intersection is limited to 2,048 combined tokens to bound recursion. Invalid input types throw `TypeError`.

## Implementation and benchmarks

The implementation intersects path segments, and characters within each segment, with memoization. All transitions advance a position except simultaneous stars, whose shared loop can be emitted directly. Identical patterns and universal patterns have fast paths. Inputs and outputs are deduplicated, and empty intersections terminate early.

The benchmark compares four workloads against `glob-intersection@0.1.3`, with 1,000 warmup calls and 10,000 measured calls per implementation. Timings depend on runtime, hardware, and input. The baseline is a performance reference only: it returns compressed brace expressions and gives `**` a different meaning, while this library materializes include/exclude arrays. It is a local comparison, not a guarantee for arbitrary globs.
