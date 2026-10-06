import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'

import { distribute } from '../src/index.ts'

const require = createRequire(import.meta.url)
const intersect = require('glob-intersection') as (left: string, right: string) => string | false
const cases: [string, string][] = [
  ['src/**/*.ts', 'src/**/*.ts'],
  ['src/*.ts', 'test/*.js'],
  ['**/*.{js,coffee}', '/hello/world/*.??'],
  ['*a*b*', '*x*y*']
]

function measure(run: () => unknown): number {
  for (let i = 0; i < 1000; i += 1) {
    run()
  }
  const start = performance.now()
  for (let i = 0; i < 10_000; i += 1) {
    run()
  }
  return performance.now() - start
}

// The baseline returns compressed braces; distribute materializes all OR alternatives.
// oxlint-disable-next-line no-console -- The benchmark reports timings to the terminal.
console.table(
  cases.map(([left, right]) => {
    const modern = measure(() => distribute([left, right]))
    const legacy = measure(() => intersect(left, right))
    return {
      patterns: JSON.stringify([left, right]),
      'distribute (ms)': modern.toFixed(1),
      'glob-intersection (ms)': legacy.toFixed(1),
      speedup: `${(legacy / modern).toFixed(2)}x`
    }
  })
)
