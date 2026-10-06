# glob-distribute

Convert an AND of glob patterns into an OR of glob alternatives. Written in TypeScript, with an ESM build, bundled declarations, and no runtime dependencies.

```sh
pnpm add glob-distribute
```

```ts
import { distribute } from 'glob-distribute'

// A string must match every input; matching any output is equivalent.
distribute(['**/*.{js,coffee}', '/hello/world/*.??'])
// ['/hello/world/*.js']

distribute(['{a,b,c}', '{b,c,d}'])
// ['b', 'c']

distribute(['*a*', '*b*'])
// ['*b*a*', '*a*b*'] (order is not a contract)

distribute(['src/*.ts', 'test/*.ts'])
// []

// A leading `!` negates a term. Complements are not globs, so they stay as `!` entries.
distribute(['**/*.{js,ts}', '!**/*.test.*'])
// ['**/*.js', '**/*.ts', '!**/*.test.*']

distribute(['{a,b,c}', '!b'])
// ['a', 'c']
```

## API

```ts
distribute(patterns: readonly string[], options?: DistributeOptions): string[]
```

The input is a conjunction: every pattern must match, and a pattern with a leading `!` must not match. The output contains deduplicated, brace-expanded alternatives, followed by any `!` terms that still matter. A string matches the output when it matches some alternative and no `!` term. Inputs are not mutated. Alternatives can overlap and are not guaranteed to be minimal or sorted. No filesystem access occurs.

An impossible intersection returns `[]`. An empty conjunction matches everything and returns `['**']`. An empty pattern matches only the empty string, so `distribute([''])` returns `['']`.

Negated terms are kept verbatim after brace expansion rather than distributed, because the complement of a glob is not expressible in this dialect. Alternatives that a negated term fully covers are dropped, as are negated terms that cannot overlap any remaining alternative. Repeated leading `!` toggles, so `!!a` is `a`.

## Glob dialect

Patterns follow [fast-glob](https://github.com/oxc-project/fast-glob), the Rust matcher used by Oxc, which shares the common globstar dialect:

| Syntax                 | Meaning                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `*`                    | Zero or more characters within a path segment                    |
| `**`                   | As a whole segment, zero or more segments; otherwise same as `*` |
| `?`                    | Exactly one Unicode code point except `/`                        |
| `{a,b}`                | Alternatives; nesting and empty branches are supported           |
| `\*`, `\?`, `\{`, etc. | A literal escaped character                                      |
| `!pattern`             | Negation; only valid at the start of a pattern                   |

A path is a sequence of `/`-separated segments. `**/file` matches `file`, `a/file`, and `a/b/file`, and `a/**/b` matches `a/b`. A trailing `**` needs at least one segment: `a/**` matches `a/` and everything below it, but not `a`. Elsewhere `**` is a single-segment wildcard, so `a**b` is normalized to `a*b`. Matching is case-sensitive and wildcards include dotfiles and newlines. Backslashes escape characters and are not Windows separators. A trailing slash is significant: `a/` matches only `a/`.

One deliberate difference: `?` matches a Unicode code point here, while fast-glob matches a single byte, so `?` never matches a non-ASCII character there.

Character classes and extglobs are unsupported: unescaped `[`, `]`, `(`, `)`, and `!` after the first character throw `SyntaxError`, as do malformed braces and dangling escapes. Braces group alternatives only, so `{a}` matches `a` and range notation is not expanded (`{1..3}` matches the literal text `1..3`). Escape braces to match them literally.

Outputs are globs in the same dialect, so fast-glob and matchers with the same semantics consume them directly. The test suite checks the semantics against verdicts recorded from fast-glob itself.

## Limits

Intersections may require exponentially many alternatives. Limits apply to the entire call, including brace expansion and intermediate results, and throw `RangeError` rather than return incomplete output.

```ts
distribute(patterns, {
  maxResults: 10_000,
  maxOperations: 100_000,
})
```

Both limits must be positive safe integers. Each input is limited to 512 UTF-16 code units; a nontrivial pairwise intersection is limited to 2,048 combined tokens to bound recursion. Invalid input types throw `TypeError`.

## Performance and development

The implementation intersects path segments, and characters within each segment, with memoization. All transitions advance a position except simultaneous stars, whose shared loop can be emitted directly. Identical patterns and universal patterns have fast paths. Inputs and outputs are deduplicated, and empty intersections terminate early.

```sh
pnpm install
pnpm run check
pnpm run test
pnpm run build
pnpm run bench
```

The benchmark compares four workloads against `glob-intersection@0.1.3`, with 1,000 warmup calls and 10,000 measured calls per implementation. Timings depend on runtime, hardware, and input. The baseline is a performance reference only: it returns compressed brace expressions and gives `**` a different meaning, while this library materializes an array. It is a local comparison, not a guarantee for arbitrary globs.

## License

[MIT](./LICENSE) License © [Liang Mi](https://github.com/liangmiQwQ) and contributors.
