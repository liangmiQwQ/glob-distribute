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
```

## API

```ts
distribute(patterns: readonly string[], options?: DistributeOptions): string[]
```

The input is a conjunction, not a list of include/exclude rules. The output contains deduplicated, brace-expanded alternatives. Inputs are not mutated. Alternatives can overlap and are not guaranteed to be minimal or sorted. No filesystem access occurs.

An impossible intersection returns `[]`. An empty conjunction matches everything and returns `['**']`. An empty pattern matches only the empty string, so `distribute([''])` returns `['']`.

## Glob dialect

This uses the small, permissive dialect of [glob-intersection](https://github.com/Pathgather/glob-intersection), with backslash escaping added:

| Syntax                 | Meaning                                                       |
| ---------------------- | ------------------------------------------------------------- |
| `*`                    | Zero or more characters except `/`                            |
| `**`                   | Zero or more characters, including `/`, anywhere in a pattern |
| `?`                    | Exactly one Unicode code point except `/`                     |
| `{a,b}`                | Alternatives; nesting and empty branches are supported        |
| `\*`, `\?`, `\{`, etc. | A literal escaped character                                   |

Matching is case-sensitive. Wildcards include dotfiles and newlines. Paths use `/`; backslashes escape characters and are not Windows separators. Slashes are literal: `**/file` requires a slash and does not match `file`. For optional directories, use `{,**/}file`.

Character classes, extglobs, and negation are unsupported: unescaped `[`, `]`, `(`, `)`, and `!` throw `SyntaxError`, as do malformed braces and dangling escapes. Braces group alternatives only; range notation is not expanded (`{1..3}` matches the literal text `1..3`). Escape braces to match them literally.

These semantics are deliberately explicit: outputs must be consumed by a matcher using the same dialect. Standard filesystem globbers often assign different meanings to dotfiles and `**`.

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

The implementation intersects token positions with memoization. All transitions advance a position except simultaneous stars, whose shared loop can be emitted directly. Identical patterns and universal patterns have fast paths. Inputs and outputs are deduplicated, and empty intersections terminate early.

```sh
pnpm install
pnpm run check
pnpm run test
pnpm run build
pnpm run bench
```

The benchmark compares four workloads against `glob-intersection@0.1.3`, with 1,000 warmup calls and 10,000 measured calls per implementation. Timings depend on runtime, hardware, and input. The baseline returns compressed brace expressions, while this library materializes an array; the benchmark includes this API difference. It is a local comparison, not a guarantee for arbitrary globs.

## License

[MIT](./LICENSE) License © [Liang Mi](https://github.com/liangmiQwQ) and contributors.
