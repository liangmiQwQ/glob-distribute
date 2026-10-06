# glob-distribute

Convert an AND of glob patterns into separate inclusion and exclusion groups, each containing OR alternatives. Written in TypeScript, with an ESM build, bundled declarations, and no runtime dependencies.

```sh
pnpm add glob-distribute
```

```ts
import { distribute } from 'glob-distribute'

// Match any include pattern, and none of the exclude patterns.
distribute(['**/*.{js,coffee}', '/hello/world/*.??'])
// { include: ['/hello/world/*.js'], exclude: [] }

distribute(['{a,b,c}', '{b,c,d}'])
// { include: ['b', 'c'], exclude: [] }

distribute(['*a*', '*b*'])
// { include: ['*b*a*', '*a*b*'], exclude: [] } (order is not a contract)

distribute(['src/*.ts', 'test/*.ts'])
// { include: [], exclude: [] }

// A leading `!` sends the pattern body to exclude.
distribute(['**/*.{js,ts}', '!**/*.test.*'])
// { include: ['**/*.js', '**/*.ts'], exclude: ['**/*.test.*'] }

distribute(['{a,b,c}', '!b'])
// { include: ['a', 'c'], exclude: [] }
```

## API

```ts
interface DistributeResult {
  include: string[]
  exclude: string[]
}

distribute(patterns: readonly string[], options?: DistributeOptions): DistributeResult
```

Every input must be satisfied. Prefix a pattern with `!` to exclude it.

A path matches the result when it matches **any `include` pattern** and **none of the `exclude` patterns**. An empty `include` matches nothing.

The function returns patterns without reading the filesystem or changing the input. Results are deduplicated and brace-expanded; their order is not guaranteed.

### Options

Intersections can grow quickly. Use these options to bound the work:

| Option          | Default   | Limit                                                                            |
| --------------- | --------- | -------------------------------------------------------------------------------- |
| `maxResults`    | `10_000`  | Alternatives, including intermediate results and combined include/exclude output |
| `maxOperations` | `100_000` | Expansion and intersection steps per call                                        |

Exceeded limits throw `RangeError`; malformed patterns throw `SyntaxError`.

## Supported patterns

Supports `*`, `**`, `?`, character classes, `{a,b}` alternatives, escapes, and leading `!` negation. Matching is case-sensitive, includes dotfiles, and uses `/` as the path separator. Extglobs and brace ranges are not supported.

The dialect follows [Oxc's Rust fast-glob matcher](https://github.com/oxc-project/fast-glob). `?` and character classes match UTF-8 bytes, so Unicode behavior may differ from other matchers.

See the [reference](./docs/reference.md) for edge cases, full syntax, compatibility notes, and limit details.

## License

[MIT](./LICENSE) License © [Liang Mi](https://github.com/liangmiQwQ) and contributors.
