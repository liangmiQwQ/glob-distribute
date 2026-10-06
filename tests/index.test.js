import { expect, expectTypeOf, test } from 'vite-plus/test'

import { distribute } from '../src/index.ts'
import compatibility from './fixtures/compatibility.json' with { type: 'json' }
import fixture from './fixtures/fast-glob.json' with { type: 'json' }

// Public examples cover AND inputs and OR outputs, including nested and empty alternatives.
test('distributes conjunctions into equivalent alternatives', () => {
  expect(distribute(['**/*.{js,coffee}', '/hello/world/*.??'])).toEqual(['/hello/world/*.js'])
  expect(distribute(['{a,b,c,x,d}', '{x,y,z,c,w}', '{c,x,q}']).toSorted()).toEqual(['c', 'x'])
  expect(distribute(['{src,{test,spec}}/*.ts', 'src/*'])).toEqual(['src/*.ts'])
  expect(distribute(['a{,b}', 'a?'])).toEqual(['ab'])
  expect(distribute(['hello', 'world'])).toEqual([])
  expect(distribute(['', '*'])).toEqual([''])
  expect(distribute([])).toEqual(['**'])
  expect(distribute(['a*', 'a*'])).toEqual(['a*'])
  expectTypeOf(distribute(['*'])).toEqualTypeOf(/** @type {string[]} */ ([]))
})

// `**` spans directories only as a whole segment, and a trailing `**` needs at least one segment, as in fast-glob.
test('treats `**` as a segment wildcard', () => {
  expect(distribute(['**/file', 'file'])).toEqual(['file'])
  expect(distribute(['src/**', '**/*.ts'])).toEqual(['src/**/*.ts'])
  expect(distribute(['a/**', 'a'])).toEqual([])
  expect(distribute(['a/**', 'a/'])).toEqual(['a/'])
  expect(distribute(['a**b', '**'])).toEqual(['a*b'])
  expect(distribute(['**/**/x', String.raw`a\/**`])).toEqual(['a/**/x'])
})

// A leading `!` negates a term; complements are not globs, so they stay as `!` entries after the alternatives.
test('keeps negated terms and drops alternatives they fully exclude', () => {
  expect(distribute(['**/*.js', '!**/*.test.js'])).toEqual(['**/*.js', '!**/*.test.js'])
  expect(distribute(['{a,b,c}', '!b']).toSorted()).toEqual(['a', 'c'])
  expect(distribute(['src/*.ts', '!test/**'])).toEqual(['src/*.ts'])
  expect(distribute(['*.ts', '!*'])).toEqual([])
  expect(distribute(['!{a,b}', '?'])).toEqual(['?', '!a', '!b'])
  expect(distribute(['!a'])).toEqual(['**', '!a'])
  expect(distribute(['!!a'])).toEqual(['a'])
  expect(distribute([String.raw`\!a`])).toEqual([String.raw`\!a`])
})

// Classes intersect as byte sets, so the output is a canonical literal, `?`, or class, as fast-glob reads them.
test('intersects character classes', () => {
  expect(distribute(['[a-z]', '[^m]'])).toEqual(['[a-ln-z]'])
  expect(distribute(['[^a]', '[!b]'])).toEqual(['[^ab]'])
  expect(distribute(['[ab]', 'b'])).toEqual(['b'])
  expect(distribute(['[ab]', '[cd]'])).toEqual([])
  expect(distribute(['[*]', '?'])).toEqual([String.raw`\*`])
  expect(distribute(['[!/]'])).toEqual(['?'])
  expect(distribute(['[z-a]'])).toEqual([])
  expect(distribute(['[]a]', '[^a]'])).toEqual([String.raw`\]`])
  expect(distribute(['{a,c[}]*}', 'c*'])).toEqual([String.raw`c\}*`])
})

// This oracle translates the documented segment semantics to regex, independently of the intersection algorithm.
const matchers = new Map()

/** @param {string} token */
function literal(token) {
  const value = token.startsWith('\\')
    ? ({ b: '\b', n: '\n', r: '\r', t: '\t' }[token[1]] ?? token.slice(1))
    : token
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
}

/** A class follows fast-glob: `^`/`!` negates, the first member is literal, `-` ranges, and `/` never matches. @param {string} token */
function classExpression(token) {
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

/** @param {string} segment */
function segmentExpression(segment) {
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

/** `**` matches zero or more whole segments, and a trailing `**` needs a segment, like `**\/*`. @param {string} pattern */
function matcher(pattern) {
  if (matchers.has(pattern)) {
    return matchers.get(pattern)
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

/** A `!` pattern is satisfied when its body does not match. @param {string} pattern @param {string} value @returns {boolean} */
function satisfies(pattern, value) {
  return pattern.startsWith('!')
    ? !satisfies(pattern.slice(1), value)
    : matcher(pattern).test(Buffer.from(value).toString('latin1'))
}

/** An output list matches when some alternative matches and every `!` term is satisfied. @param {string[]} output @param {string} value */
function matchesList(output, value) {
  const alternatives = output.filter(pattern => !pattern.startsWith('!'))
  const negations = output.filter(pattern => pattern.startsWith('!'))
  return (
    alternatives.some(pattern => satisfies(pattern, value)) &&
    negations.every(pattern => satisfies(pattern, value))
  )
}

/** @param {string[]} alphabet @param {number} length */
function words(alphabet, length) {
  let layer = ['']
  const result = [...layer]
  for (let i = 0; i < length; i += 1) {
    layer = layer.flatMap(prefix => alphabet.map(char => prefix + char))
    result.push(...layer)
  }
  return result
}

test('preserves matching semantics across wildcard overlaps and separators', () => {
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
  for (const inputs of fixtures) {
    const output = distribute(inputs)
    const expected = candidates.filter(value => inputs.every(pattern => satisfies(pattern, value)))
    const actual = candidates.filter(value => matchesList(output, value))
    expect(actual, JSON.stringify({ inputs, output })).toEqual(expected)
  }
})

// The fixture holds fast-glob's own verdicts, so the oracle above and the expansion agree with the reference matcher.
test('matches like fast-glob on every fixture pattern', () => {
  for (const [pattern, bits] of Object.entries(fixture.matches)) {
    const output = distribute([pattern])
    const expected = fixture.paths.filter((_, i) => bits[i] === '1')
    const actual = fixture.paths.filter(value => matchesList(output, value))
    expect(actual, JSON.stringify({ pattern, output })).toEqual(expected)
  }
})

test('validates upstream syntax and bounds expansion without returning partial results', () => {
  for (const pattern of ['[a', '[]', '[!]', String.raw`[\]`, '{a,b', 'a\\']) {
    expect(() => distribute([pattern])).toThrow(SyntaxError)
  }
  expect(() => distribute(['no', 'match', '[a'])).toThrow(SyntaxError)
  expect(distribute(['a'.repeat(513)])).toEqual(['a'.repeat(513)])
  expect(distribute([`${'!'.repeat(514)}a`])).toEqual(['a'])
  expect(() => distribute(['{a}'.repeat(11)])).toThrow(/10 brace groups/u)
  expect(() => distribute([`${'{'.repeat(11)}a${'}'.repeat(11)}`])).toThrow(/10 nesting levels/u)
  expect(distribute(['{a,a}'], { maxResults: 1 })).toEqual(['a'])
  expect(() => distribute(['{a,b,c}'], { maxResults: 2 })).toThrow(RangeError)
  expect(() => distribute(['?', '!a', '!b'], { maxResults: 2 })).toThrow(RangeError)
  expect(() => distribute(['*a*b*', '*c*d*'], { maxOperations: 20 })).toThrow(RangeError)
  expect(() => distribute(['*'], { maxResults: 0 })).toThrow(RangeError)
  expect(() => distribute(['*'], { maxOperations: Infinity })).toThrow(RangeError)
  // @ts-expect-error JavaScript callers also get a clear input error.
  expect(() => distribute([42])).toThrow(TypeError)
})

// Recorded by the real Rust matcher; expected input semantics do not come from the JavaScript oracle.
test('preserves fast-glob syntax through expansion and intersection', () => {
  for (const { inputs, matches } of compatibility.cases) {
    const output = distribute(inputs)
    const expected = compatibility.paths.filter((_, i) => matches[i] === '1')
    const actual = compatibility.paths.filter(value => matchesList(output, value))
    expect(actual, JSON.stringify({ inputs, output })).toEqual(expected)
  }
})

// Unlike the upstream matcher, reaching a brace globstar does not commit an earlier wildcard's first match.
test('keeps wildcard language semantics across brace globstars', () => {
  const output = distribute(['*a{**}/'])
  for (const value of ['a', 'aa', 'ba', 'baa', 'a/', 'a/x/']) {
    expect(matchesList(output, value), value).toBe(true)
  }
  for (const value of ['', 'b', 'ab', 'a/x']) {
    expect(matchesList(output, value), value).toBe(false)
  }
  expect(matchesList(distribute(['*{**}/']), 'a')).toBe(true)
  expect(matchesList(distribute(['*a{**}/', 'aa']), 'aa')).toBe(true)
  expect(matchesList(distribute(['*', '!*a{**}/']), 'aa')).toBe(false)
})

// A failed class scan must not restart at every later opening bracket.
test('handles long closed and unclosed character classes', () => {
  expect(distribute([`[${'a'.repeat(20_000)}]`])).toEqual(['a'])
  expect(() => distribute(['['.repeat(100_000)])).toThrow('Unclosed character class in glob')
  expect(distribute(['[[]'])).toEqual([String.raw`\[`])
  expect(distribute(['[]]'])).toEqual([String.raw`\]`])
  expect(distribute([String.raw`[a\]]`])).toEqual([String.raw`[\]a]`])
  expect(distribute(['[!]]'])).toEqual([String.raw`[^\]]`])
})

// Repeated stars used to tokenize every growing prefix; escaped stars must still remain literals.
test('normalizes long wildcard patterns without rescanning prefixes', () => {
  const pattern = 'a*'.repeat(10_000)
  expect(distribute([pattern])).toEqual([pattern])
  expect(distribute([String.raw`\*{*,**/x}`])).toEqual([
    String.raw`\**`,
    String.raw`\*x`,
    String.raw`\**/**/x`
  ])
})
