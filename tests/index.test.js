import picomatch from 'picomatch'
import { expect, expectTypeOf, test } from 'vite-plus/test'

import { distribute } from '../src/index.ts'

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

// `**` spans directories only as a whole segment, matching zero or more of them, as standard globbers do.
test('treats `**` as a segment wildcard and single-element braces as literal text', () => {
  expect(distribute(['**/file', 'file'])).toEqual(['file'])
  expect(distribute(['src/**/*.ts', 'src/*.ts'])).toEqual(['src/*.ts'])
  expect(distribute(['a/**', 'a'])).toEqual(['a'])
  expect(distribute(['a**b', '**'])).toEqual(['a*b'])
  expect(distribute(['**/**/x', String.raw`a\/**`])).toEqual(['a/**/x'])
  expect(distribute(['{a}', '{a,b}'])).toEqual([])
  expect(distribute(['{a}', String.raw`\{a\}`])).toEqual(['{a}'])
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

// This oracle encodes the documented segment semantics independently of the intersection algorithm.
const matchers = new Map()

/** @param {string} segment */
function segmentMatcher(segment) {
  if (matchers.has(segment)) {
    return matchers.get(segment)
  }
  const tokens = segment.match(/\\[\s\S]|[^]/gu) ?? []
  const expression = tokens
    .map(token => {
      if (token === '*') {
        return '[^/]*'
      }
      if (token === '?') {
        return '[^/]'
      }
      return token.replace(/^\\/u, '').replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
    })
    .join('')
  const regex = new RegExp(`^(?:${expression})$(?!.)`, 'su')
  matchers.set(segment, regex)
  return regex
}

/** `**` matches zero or more whole segments; any other segment matches exactly one. @param {string[]} pattern @param {string[]} path @returns {boolean} */
function matchesSegments(pattern, path) {
  const head = pattern.at(0)
  const rest = pattern.slice(1)
  if (head === undefined) {
    return path.length === 0
  }
  if (head === '**') {
    return path.some((_, i) => matchesSegments(rest, path.slice(i))) || matchesSegments(rest, [])
  }
  return (
    path.length > 0 && segmentMatcher(head).test(path[0]) && matchesSegments(rest, path.slice(1))
  )
}

/** A `!` pattern is satisfied when its body does not match. @param {string} pattern @param {string} value @returns {boolean} */
function satisfies(pattern, value) {
  return pattern.startsWith('!')
    ? !satisfies(pattern.slice(1), value)
    : matchesSegments(pattern.split('/'), value.split('/'))
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
    ['!a', '!/']
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

// Spot-check the documented semantics against picomatch, the matcher behind fast-glob, globby, and tinyglobby.
test('agrees with picomatch on ordinary relative paths', () => {
  const fixtures = [
    ['**/*.ts', '!**/*.test.ts'],
    ['src/**', '**/*.{js,ts}'],
    ['a/**/b', '**/b/**'],
    ['**/x', 'a/*/x'],
    ['a**b', '**'],
    ['*.?s', '!*.{j,t}s']
  ]
  // Picomatch ignores slashes at the path edges and never lets wildcards match a bare `.` segment.
  const candidates = words(['a', 'b', '.', 'x', 'ts', 'js', '/'], 4).filter(
    value => value !== '' && !/^\/|\/$|\/\/|(?:^|\/)\.(?:\/|$)/u.test(value)
  )
  for (const inputs of fixtures) {
    const output = distribute(inputs)
    for (const value of candidates) {
      const expected = inputs.every(pattern => picomatch(pattern, { dot: true })(value))
      const actual = matchesList(output, value)
      expect(actual, JSON.stringify({ inputs, output, value })).toBe(expected)
    }
  }
})

test('rejects unsupported syntax and bounds expansion without returning partial results', () => {
  for (const pattern of ['[a-z]', 'a!b', '*(a)', '{a,b', 'a}', 'a\\']) {
    expect(() => distribute([pattern])).toThrow(SyntaxError)
  }
  expect(() => distribute(['no', 'match', '[a]'])).toThrow(SyntaxError)
  expect(() => distribute(['a'.repeat(513)])).toThrow(RangeError)
  expect(() => distribute(['!'.repeat(513)])).toThrow(RangeError)
  expect(() => distribute(['{a,b,c}'], { maxResults: 2 })).toThrow(RangeError)
  expect(() => distribute(['?', '!a', '!b'], { maxResults: 2 })).toThrow(RangeError)
  expect(() => distribute(['*a*b*', '*c*d*'], { maxOperations: 20 })).toThrow(RangeError)
  expect(() => distribute(['*'], { maxResults: 0 })).toThrow(RangeError)
  expect(() => distribute(['*'], { maxOperations: Infinity })).toThrow(RangeError)
  // @ts-expect-error JavaScript callers also get a clear input error.
  expect(() => distribute([42])).toThrow(TypeError)
})
