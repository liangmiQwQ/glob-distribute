import { expect, expectTypeOf, test } from 'vite-plus/test'

import { distribute } from '../src/index.js'

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

// This oracle translates the documented syntax to regex, independently of the intersection algorithm.
/** @param {string} pattern */
function matcher(pattern) {
  const tokens = pattern.match(/\\[\s\S]|\*\*|[^]/gu) ?? []
  const expression = tokens
    .map(token => {
      if (token === '**') {
        return String.raw`[\s\S]*`
      }
      if (token === '*') {
        return '[^/]*'
      }
      if (token === '?') {
        return '[^/]'
      }
      return token.replace(/^\\/u, '').replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
    })
    .join('')
  return new RegExp(`^(?:${expression})$(?!.)`, 'su')
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
    ['.env', '*']
  ]
  for (const left of patterns) {
    for (const right of patterns) {
      fixtures.push([left, right])
    }
  }
  for (const inputs of fixtures) {
    const output = distribute(inputs)
    const before = inputs.map(matcher)
    const after = output.map(matcher)
    const expected = candidates.filter(value => before.every(regex => regex.test(value)))
    const actual = candidates.filter(value => after.some(regex => regex.test(value)))
    expect(actual, JSON.stringify({ inputs, output })).toEqual(expected)
  }
})

test('rejects unsupported syntax and bounds expansion without returning partial results', () => {
  for (const pattern of ['[a-z]', '!foo', '*(a)', '{a,b', 'a}', 'a\\']) {
    expect(() => distribute([pattern])).toThrow(SyntaxError)
  }
  expect(() => distribute(['no', 'match', '[a]'])).toThrow(SyntaxError)
  expect(() => distribute(['a'.repeat(513)])).toThrow(RangeError)
  expect(() => distribute(['{a,b,c}'], { maxResults: 2 })).toThrow(RangeError)
  expect(() => distribute(['*a*b*', '*c*d*'], { maxOperations: 20 })).toThrow(RangeError)
  expect(() => distribute(['*'], { maxResults: 0 })).toThrow(RangeError)
  expect(() => distribute(['*'], { maxOperations: Infinity })).toThrow(RangeError)
  // @ts-expect-error JavaScript callers also get a clear input error.
  expect(() => distribute([42])).toThrow(TypeError)
})
