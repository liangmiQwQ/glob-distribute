import { describe, expect, expectTypeOf, it } from 'vite-plus/test'

import type { DistributeResult } from '../src/index.ts'
import { distribute } from '../src/index.ts'
import compatibility from './fixtures/compatibility.json' with { type: 'json' }
import fixture from './fixtures/fast-glob.json' with { type: 'json' }

// Public examples cover AND inputs and include/exclude OR groups, including nested and empty alternatives.
it('distributes conjunctions into equivalent alternatives', () => {
  expect(distribute(['**/*.{js,coffee}', '/hello/world/*.??'])).toEqual({
    include: ['/hello/world/*.js'],
    exclude: []
  })
  expect(distribute(['{a,b,c,x,d}', '{x,y,z,c,w}', '{c,x,q}']).include.toSorted()).toEqual([
    'c',
    'x'
  ])
  expect(distribute(['{src,{test,spec}}/*.ts', 'src/*'])).toEqual({
    include: ['src/*.ts'],
    exclude: []
  })
  expect(distribute(['a{,b}', 'a?'])).toEqual({ include: ['ab'], exclude: [] })
  expect(distribute(['hello', 'world'])).toEqual({ include: [], exclude: [] })
  expect(distribute(['', '*'])).toEqual({ include: [''], exclude: [] })
  expect(distribute([])).toEqual({ include: ['**'], exclude: [] })
  expect(distribute(['a*', 'a*'])).toEqual({ include: ['a*'], exclude: [] })
  expectTypeOf(distribute(['*'])).toEqualTypeOf<{ include: string[]; exclude: string[] }>()
})

// `**` spans directories only as a whole segment, and a trailing `**` needs at least one segment, as in fast-glob.
it('treats `**` as a segment wildcard', () => {
  expect(distribute(['**/file', 'file'])).toEqual({ include: ['file'], exclude: [] })
  expect(distribute(['src/**', '**/*.ts'])).toEqual({ include: ['src/**/*.ts'], exclude: [] })
  expect(distribute(['a/**', 'a'])).toEqual({ include: [], exclude: [] })
  expect(distribute(['a/**', 'a/'])).toEqual({ include: ['a/'], exclude: [] })
  expect(distribute(['a**b', '**'])).toEqual({ include: ['a*b'], exclude: [] })
  expect(distribute(['**/**/x', String.raw`a\/**`])).toEqual({ include: ['a/**/x'], exclude: [] })
})

// Input negations become ordinary OR alternatives in exclude; literal exclamation marks stay escaped.
it('separates inclusion and exclusion unions and removes redundant terms', () => {
  expect(distribute(['**/*.js', '!**/*.test.js'])).toEqual({
    include: ['**/*.js'],
    exclude: ['**/*.test.js']
  })
  expect(distribute(['{a,b,c}', '!b']).include.toSorted()).toEqual(['a', 'c'])
  expect(distribute(['src/*.ts', '!test/**'])).toEqual({ include: ['src/*.ts'], exclude: [] })
  expect(distribute(['*.ts', '!*'])).toEqual({ include: [], exclude: [] })
  expect(distribute(['!{a,b}', '?'])).toEqual({ include: ['?'], exclude: ['a', 'b'] })
  expect(distribute(['!a'])).toEqual({ include: ['**'], exclude: ['a'] })
  expect(distribute(['!!a'])).toEqual({ include: ['a'], exclude: [] })
  expect(distribute([String.raw`\!a`])).toEqual({ include: [String.raw`\!a`], exclude: [] })
  expect(distribute(['{!abc}'])).toEqual({ include: [String.raw`\!abc`], exclude: [] })
  expect(distribute(['*', '!{!abc}'])).toEqual({ include: ['*'], exclude: [String.raw`\!abc`] })
  expect(distribute(['*', '![!abc]'])).toEqual({ include: ['*'], exclude: ['[^a-c]'] })
  expect(distribute(['!'])).toEqual({ include: ['**'], exclude: [''] })
})

// Classes intersect as byte sets, so the output is a canonical literal, `?`, or class, as fast-glob reads them.
it('intersects character classes', () => {
  expect(distribute(['[a-z]', '[^m]'])).toEqual({ include: ['[a-ln-z]'], exclude: [] })
  expect(distribute(['[^a]', '[!b]'])).toEqual({ include: ['[^ab]'], exclude: [] })
  expect(distribute(['[ab]', 'b'])).toEqual({ include: ['b'], exclude: [] })
  expect(distribute(['[ab]', '[cd]'])).toEqual({ include: [], exclude: [] })
  expect(distribute(['[*]', '?'])).toEqual({ include: [String.raw`\*`], exclude: [] })
  expect(distribute(['[!/]'])).toEqual({ include: ['?'], exclude: [] })
  expect(distribute(['[z-a]'])).toEqual({ include: [], exclude: [] })
  expect(distribute(['[]a]', '[^a]'])).toEqual({ include: [String.raw`\]`], exclude: [] })
  expect(distribute(['{a,c[}]*}', 'c*'])).toEqual({ include: [String.raw`c\}*`], exclude: [] })
})

// This oracle translates the documented segment semantics to regex, independently of the intersection algorithm.
const matchers = new Map<string, RegExp>()
const escapes: Record<string, string> = { b: '\b', n: '\n', r: '\r', t: '\t' }

function literal(token: string) {
  const value = token.startsWith('\\') ? (escapes[token[1]] ?? token.slice(1)) : token
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
}

/** A class follows fast-glob: `^`/`!` negates, the first member is literal, `-` ranges, and `/` never matches. */
function classExpression(token: string) {
  const negated = /^\[[!^]/u.test(token)
  const members = token.slice(negated ? 2 : 1, -1).match(/\\[\s\S]|[^]/gu) ?? []
  const body = members
    .map((member, i) =>
      member === '-' && i > 0 && i < members.length - 1
        ? '-'
        : `\\u{${(member.replace(/^\\/u, '').codePointAt(0) ?? 0).toString(16)}}`
    )
    .join('')
  return negated ? `[^/${body}]` : `(?!/)[${body}]`
}

function segmentExpression(segment: string) {
  const tokens = segment.match(/\\[\s\S]|\[[!^]?(?:\\[\s\S]|[^])(?:\\[\s\S]|[^\]])*\]|[^]/gu) ?? []
  return tokens
    .map(token => {
      if (token === '*') {
        return '[^/]*'
      }
      if (token === '?') {
        return '[^/]'
      }
      return token.startsWith('[') ? classExpression(token) : literal(token)
    })
    .join('')
}

/** `**` matches zero or more whole segments, and a trailing `**` needs a segment, like `**\/*`. */
function matcher(pattern: string) {
  const cached = matchers.get(pattern)
  if (cached) {
    return cached
  }
  const bytes = Buffer.from(pattern).toString('latin1')
  const segments = bytes.replace(/(^|\/)\*\*$/u, '$1**/*').split('/')
  const expression = segments
    .map(segment => (segment === '**' ? '(?:[^/]*/)*' : `${segmentExpression(segment)}/`))
    .join('')
    .slice(0, -1)
  const regex = new RegExp(`^(?:${expression})$(?!.)`, 'su')
  matchers.set(pattern, regex)
  return regex
}

/** A `!` pattern is satisfied when its body does not match. */
function satisfies(pattern: string, value: string): boolean {
  return pattern.startsWith('!')
    ? !satisfies(pattern.slice(1), value)
    : matcher(pattern).test(Buffer.from(value).toString('latin1'))
}

/** Match either union with OR, then remove the exclusion union. */
function matchesResult(output: DistributeResult, value: string) {
  const bytes = Buffer.from(value).toString('latin1')
  return (
    output.include.some(pattern => matcher(pattern).test(bytes)) &&
    !output.exclude.some(pattern => matcher(pattern).test(bytes))
  )
}

function words(alphabet: string[], length: number) {
  let layer = ['']
  const result = [...layer]
  for (let i = 0; i < length; i += 1) {
    layer = layer.flatMap(prefix => alphabet.map(char => prefix + char))
    result.push(...layer)
  }
  return result
}

describe('preserves matching semantics across wildcard overlaps and separators', () => {
  const patterns = words(['a', '/', '?', '*', '**'], 3)
  const candidates = words(['a', 'b', '/', '.', '🌟', '\n'], 3)
  const fixtures = [
    ['*a*b*', '*b*a*'],
    ['a**b', '**/b'],
    ['*a*', '*b*', '*?*'],
    [String.raw`\*?`, '*🌟'],
    [String.raw`a\,b`, 'a?b'],
    [String.raw`\[a\]`, '?a?'],
    ['.env', '*'],
    ['*a*', '!*b*'],
    ['**', '!a/**'],
    ['?', '!a*', '!?b'],
    ['!a', '!/'],
    ['[ab]*', '*[^a]'],
    ['[.-a]/**', '**/[!b]'],
    ['[]a]', '?', '!a']
  ]
  for (const left of patterns) {
    for (const right of patterns) {
      fixtures.push([left, right])
    }
  }
  // Register each input separately so exhaustive coverage does not share one test timeout.
  for (const inputs of fixtures) {
    it(`inputs ${JSON.stringify(inputs)}`, () => {
      const output = distribute(inputs)
      const expected = candidates.filter(value =>
        inputs.every(pattern => satisfies(pattern, value))
      )
      const actual = candidates.filter(value => matchesResult(output, value))
      expect(actual).toEqual(expected)
    })
  }
})

// The fixture holds fast-glob's own verdicts, so the oracle above and the expansion agree with the reference matcher.
describe('matches like fast-glob on every fixture pattern', () => {
  for (const [pattern, bits] of Object.entries(fixture.matches)) {
    it(`pattern ${JSON.stringify(pattern)}`, () => {
      const output = distribute([pattern])
      const expected = fixture.paths.filter((_, i) => bits[i] === '1')
      const actual = fixture.paths.filter(value => matchesResult(output, value))
      expect(actual).toEqual(expected)
    })
  }
})

describe('rejects invalid upstream syntax', () => {
  for (const pattern of ['[a', '[]', '[!]', String.raw`[\]`, '{a,b', 'a\\']) {
    it(`pattern ${JSON.stringify(pattern)}`, () => {
      expect(() => distribute([pattern])).toThrow(SyntaxError)
    })
  }
})

it('validates upstream syntax and bounds expansion without returning partial results', () => {
  expect(() => distribute(['no', 'match', '[a'])).toThrow(SyntaxError)
  expect(distribute(['a'.repeat(513)])).toEqual({ include: ['a'.repeat(513)], exclude: [] })
  expect(distribute([`${'!'.repeat(514)}a`])).toEqual({ include: ['a'], exclude: [] })
  expect(() => distribute(['{a}'.repeat(11)])).toThrow(/10 brace groups/u)
  expect(() => distribute([`${'{'.repeat(11)}a${'}'.repeat(11)}`])).toThrow(/10 nesting levels/u)
  expect(distribute(['{a,a}'], { maxResults: 1 })).toEqual({ include: ['a'], exclude: [] })
  expect(() => distribute(['{a,b,c}'], { maxResults: 2 })).toThrow(RangeError)
  expect(() => distribute(['?', '!a', '!b'], { maxResults: 2 })).toThrow(RangeError)
  expect(() => distribute(['*a*b*', '*c*d*'], { maxOperations: 20 })).toThrow(RangeError)
  expect(() => distribute(['*'], { maxResults: 0 })).toThrow(RangeError)
  expect(() => distribute(['*'], { maxOperations: Infinity })).toThrow(RangeError)
  // @ts-expect-error JavaScript callers also get a clear input error.
  expect(() => distribute([42])).toThrow(TypeError)
})

// Recorded by the real Rust matcher; expected input semantics do not come from the JavaScript oracle.
describe('preserves fast-glob syntax through expansion and intersection', () => {
  for (const { inputs, matches } of compatibility.cases) {
    it(`inputs ${JSON.stringify(inputs)}`, () => {
      const output = distribute(inputs)
      const expected = compatibility.paths.filter((_, i) => matches[i] === '1')
      const actual = compatibility.paths.filter(value => matchesResult(output, value))
      expect(actual).toEqual(expected)
    })
  }
})

// Unlike the upstream matcher, reaching a brace globstar does not commit an earlier wildcard's first match.
describe('keeps wildcard language semantics across brace globstars', () => {
  for (const value of ['a', 'aa', 'ba', 'baa', 'a/', 'a/x/']) {
    it(`matches ${JSON.stringify(value)}`, () => {
      expect(matchesResult(distribute(['*a{**}/']), value)).toBe(true)
    })
  }
  for (const value of ['', 'b', 'ab', 'a/x']) {
    it(`rejects ${JSON.stringify(value)}`, () => {
      expect(matchesResult(distribute(['*a{**}/']), value)).toBe(false)
    })
  }
  it('matches a brace globstar without a literal prefix', () => {
    expect(matchesResult(distribute(['*{**}/']), 'a')).toBe(true)
  })
  it('intersects a brace globstar with a literal', () => {
    expect(matchesResult(distribute(['*a{**}/', 'aa']), 'aa')).toBe(true)
  })
  it('excludes a brace globstar match', () => {
    expect(matchesResult(distribute(['*', '!*a{**}/']), 'aa')).toBe(false)
  })
})

// A failed class scan must not restart at every later opening bracket.
it('handles long closed and unclosed character classes', () => {
  expect(distribute([`[${'a'.repeat(20_000)}]`])).toEqual({ include: ['a'], exclude: [] })
  expect(() => distribute(['['.repeat(100_000)])).toThrow('Unclosed character class in glob')
  expect(distribute(['[[]'])).toEqual({ include: [String.raw`\[`], exclude: [] })
  expect(distribute(['[]]'])).toEqual({ include: [String.raw`\]`], exclude: [] })
  expect(distribute([String.raw`[a\]]`])).toEqual({ include: [String.raw`[\]a]`], exclude: [] })
  expect(distribute(['[!]]'])).toEqual({ include: [String.raw`[^\]]`], exclude: [] })
})

// Repeated stars used to tokenize every growing prefix; escaped stars must still remain literals.
it('normalizes long wildcard patterns without rescanning prefixes', () => {
  const pattern = 'a*'.repeat(10_000)
  expect(distribute([pattern])).toEqual({ include: [pattern], exclude: [] })
  expect(distribute([String.raw`\*{*,**/x}`])).toEqual({
    include: [String.raw`\**`, String.raw`\*x`, String.raw`\**/**/x`],
    exclude: []
  })
})
