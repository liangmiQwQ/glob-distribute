export interface DistributeOptions {
  /** Maximum alternatives in any intermediate or final union. Default: 10,000. */
  maxResults?: number
  /** Maximum expansion and intersection steps per call. Default: 100,000. */
  maxOperations?: number
}

interface Budget {
  step: () => void
  check: (size: number) => void
}

/**
 * A pattern is a sequence of units: characters inside a segment, segments inside a path.
 * `star` matches zero or more units and `meet` intersects two single units, so one engine serves both levels.
 */
interface Level {
  star: string
  separator: string
  split: (pattern: string) => string[]
  join: (pattern: string) => string
  meet: (left: string, right: string, budget: Budget) => string[]
}

/** Return glob alternatives matching every input pattern. No filesystem access is performed. */
export function distribute(patterns: readonly string[], options: DistributeOptions = {}): string[] {
  const budget = createBudget(options)
  if (!Array.isArray(patterns) || patterns.some(pattern => typeof pattern !== 'string')) {
    throw new TypeError('Expected an array of glob strings')
  }

  // 1. Parse every input before intersecting so invalid syntax never depends on input order.
  const included: string[][] = []
  const excluded: string[] = []
  for (const pattern of new Set(patterns.map(stripNegation))) {
    const group = parse(toBytes(pattern.replace(/^!/u, '')), budget)
    if (pattern.startsWith('!')) {
      excluded.push(...group)
    } else {
      included.push(group)
    }
  }

  // 2. Intersect the positive terms, smallest groups first to keep intermediate unions small.
  included.sort((left, right) => left.length - right.length)
  let result = ['**']
  for (const group of included) {
    const next = new Set<string>()
    for (const left of result) {
      for (const right of group) {
        budget.step()
        for (const pattern of intersect(left, right, budget)) {
          add(next, pattern, budget)
        }
      }
    }
    result = [...next]
    if (result.length === 0) {
      break
    }
  }

  // 3. A complement is not a glob, so negations stay as `!` terms; only redundant ones are removed.
  const kept = result.filter(pattern => !excluded.some(negated => covers(negated, pattern, budget)))
  const negations = excluded.filter(negated =>
    kept.some(pattern => intersect(pattern, negated, budget).length > 0)
  )
  const output = new Set(kept)
  for (const negated of negations) {
    add(output, `!${negated}`, budget)
  }
  const serialized = new Set<string>()
  for (const pattern of output) {
    for (const value of serialize(pattern, budget)) {
      add(serialized, value, budget)
    }
  }
  return [...serialized]
}

/** Collapse leading `!` so `!!a` is `a`, and `!!!a` is `!a`. */
function stripNegation(pattern: string): string {
  const body = pattern.replace(/^!+/u, '')
  return (pattern.length - body.length) % 2 === 0 ? body : `!${body}`
}

/** Whether `pattern` is contained in `negated`, so every string it matches is excluded. */
function covers(negated: string, pattern: string, budget: Budget): boolean {
  return intersect(pattern, negated, budget).includes(pattern)
}

function createBudget(options: DistributeOptions): Budget {
  const { maxResults = 10_000, maxOperations = 100_000 } = options
  for (const value of [maxResults, maxOperations]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError('Limits must be positive safe integers')
    }
  }
  let operations = 0
  return {
    step() {
      operations += 1
      if (operations > maxOperations) {
        throw new RangeError('Glob operation limit exceeded')
      }
    },
    check(size) {
      if (size > maxResults) {
        throw new RangeError('Glob alternative limit exceeded')
      }
    }
  }
}

function add(target: Set<string>, value: string, budget: Budget): void {
  budget.step()
  target.add(value)
  budget.check(target.size)
}

const ESCAPED = String.raw`\\[\s\S]`
const CHARACTER = new RegExp(`${ESCAPED}|[^]`, 'gu')

function tokenize(pattern: string): string[] {
  const characters = pattern.match(CHARACTER) ?? []
  const tokens: string[] = []
  let classesPossible = true
  for (let i = 0; i < characters.length; i += 1) {
    if (characters[i] === '[' && classesPossible) {
      let first = i + 1
      if (characters[first] === '!' || characters[first] === '^') {
        first += 1
      }
      // The first member is literal, even when it is ]; escaped characters are already single units.
      let end = first + 1
      while (end < characters.length && characters[end] !== ']') {
        end += 1
      }
      if (end < characters.length) {
        tokens.push(characters.slice(i, end + 1).join(''))
        i = end
        continue
      }
      // No closing bracket remains for any later opener. Emit ordinary tokens without rescanning the suffix.
      classesPossible = false
    }
    tokens.push(characters[i])
  }
  return tokens
}

interface Token {
  value: string
  index: number
}

/** Expand choices without erasing the source boundaries used by fast-glob's globstar matcher. */
function parse(pattern: string, budget: Budget): string[] {
  let offset = 0
  const tokens = tokenize(pattern).map(value => {
    const token = { value, index: offset }
    offset += value.length
    return token
  })
  let position = 0
  let groups = 0

  function sequence(depth: number): Token[][] {
    let result: Token[][] = [[]]
    while (position < tokens.length) {
      const token = tokens[position]
      if (depth > 0 && (token.value === ',' || token.value === '}')) {
        break
      }
      position += 1
      let alternatives = [[token]]
      if (token.value === '{') {
        groups += 1
        if (depth >= 10 || groups > 10) {
          throw new SyntaxError(
            'Glob patterns support at most 10 brace groups and 10 nesting levels'
          )
        }
        alternatives = []
        const seen = new Set<string>()
        for (;;) {
          // Entering a branch resets match_start, even when the branch is empty.
          const start = tokens[position]?.index ?? pattern.length
          const choices = sequence(depth + 1)
          const separator = tokens.at(position++)
          for (const choice of choices) {
            const key = JSON.stringify(choice.map(token => token.value))
            if (seen.has(key)) {
              continue
            }
            seen.add(key)
            alternatives.push([{ value: '{', index: start }, ...choice, { value: '}', index: 0 }])
            budget.check(alternatives.length)
          }
          if (separator?.value === '}') {
            break
          }
          if (separator?.value !== ',') {
            throw new SyntaxError('Unclosed brace in glob')
          }
        }
      } else if (token.value === '[' || token.value === '\\') {
        throw new SyntaxError(
          token.value === '[' ? 'Unclosed character class in glob' : 'Trailing backslash in glob'
        )
      } else if (token.value === '}') {
        alternatives = [[{ ...token, value: String.raw`\}` }]]
      }
      if (alternatives.length === 1) {
        for (const prefix of result) {
          budget.step()
          for (const token of alternatives[0]) {
            prefix.push(token)
          }
        }
        continue
      }
      const expanded: Token[][] = []
      for (const prefix of result) {
        for (const suffix of alternatives) {
          budget.step()
          expanded.push([...prefix, ...suffix])
          budget.check(expanded.length)
        }
      }
      result = expanded
    }
    return result
  }

  const output = new Set<string>()
  for (const alternative of sequence(0)) {
    for (const normalized of normalize(alternative, pattern, budget)) {
      add(output, normalized, budget)
    }
  }
  return [...output]
}

/** Interpret stars before removing braces: adjacent stars from separate branches never become a globstar. */
function normalize(tokens: Token[], source: string, budget: Budget): string[] {
  const units: string[] = []
  let start = 0
  for (let i = 0; i < tokens.length; i += 1) {
    const { value, index } = tokens[i]
    if (value === '{') {
      start = index
      continue
    }
    if (value === '}') {
      continue
    }
    if (value === '*') {
      let end = index + 1
      if (source[end] === '*') {
        end += 1
        while (source.slice(end, end + 4) === '/**/') {
          end += 3
        }
        if (source.slice(end) === '/**') {
          end += 3
        }
        while (tokens[i + 1] && tokens[i + 1].value !== '}' && tokens[i + 1].index < end) {
          i += 1
        }
        let next = i + 1
        while (tokens[next]?.value === '}') {
          next += 1
        }
        if (
          (index <= start || source[end - 3] === '/') &&
          (!tokens[next] || tokens[next].value === '/')
        ) {
          units.push(tokens[next] ? '**/' : '**')
          i = next
          continue
        }
      }
      if (units.at(-1) !== '*') {
        units.push('*')
      }
    } else if (value.startsWith('[')) {
      const formatted = formatRanges(parseClass(value))
      if (formatted.length === 0) {
        return []
      }
      units.push(...formatted)
    } else {
      units.push(value === '?' ? '?' : escape(codePoint(value), LITERAL_SPECIALS))
    }
  }

  let result = new Map([['', false]])
  for (const unit of units) {
    const next = new Map<string, boolean>()
    function append(prefix: string, endsWithStar: boolean): void {
      budget.step()
      next.set(prefix, endsWithStar)
      budget.check(next.size)
    }
    for (const [prefix, endsWithStar] of result) {
      // A brace branch can start ** in the middle of a segment. Split its zero-directory and recursive cases.
      if ((unit === '**/' || unit === '**') && prefix !== '' && !prefix.endsWith('/')) {
        const starred = endsWithStar ? prefix : `${prefix}*`
        append(unit === '**' ? starred : prefix, unit === '**' || endsWithStar)
        append(`${starred}/${unit}`, unit === '**')
      } else {
        append(unit === '*' && endsWithStar ? prefix : prefix + unit, unit === '*' || unit === '**')
      }
    }
    result = next
  }
  return [...result.keys()]
}

/** Sorted, disjoint inclusive byte ranges. Every single-character unit is a set, so one intersection serves them all. */
type Ranges = [number, number][]

const MAX_BYTE = 255
const SLASH: Ranges = [[47, 47]]
const LITERAL_SPECIALS = new Set(String.raw`\*?[]{}(),!`)
const CLASS_SPECIALS = new Set(String.raw`\]-^!`)
const ANY: Ranges = subtract(complement([]), SLASH)

function unescape(token: string): string {
  if (!token.startsWith('\\')) {
    return token
  }
  return (
    ({ b: '\b', n: '\n', r: '\r', t: '\t' } as Record<string, string>)[token[1]] ?? token.slice(1)
  )
}

function codePoint(token: string): number {
  return unescape(token).codePointAt(0) ?? 0
}

/** Merge overlapping or adjacent ranges into canonical form. */
function merge(ranges: Ranges): Ranges {
  const merged: Ranges = []
  for (const [low, high] of ranges.toSorted((left, right) => left[0] - right[0])) {
    const last = merged.at(-1)
    if (last && low <= last[1] + 1) {
      last[1] = Math.max(last[1], high)
    } else {
      merged.push([low, high])
    }
  }
  return merged
}

function complement(ranges: Ranges): Ranges {
  const result: Ranges = []
  let next = 0
  for (const [low, high] of ranges) {
    if (low > next) {
      result.push([next, low - 1])
    }
    next = high + 1
  }
  if (next <= MAX_BYTE) {
    result.push([next, MAX_BYTE])
  }
  return result
}

function intersectRanges(left: Ranges, right: Ranges): Ranges {
  const result: Ranges = []
  for (const [lowA, highA] of left) {
    for (const [lowB, highB] of right) {
      const low = Math.max(lowA, lowB)
      const high = Math.min(highA, highB)
      if (low <= high) {
        result.push([low, high])
      }
    }
  }
  return result
}

function subtract(ranges: Ranges, removed: Ranges): Ranges {
  return intersectRanges(ranges, complement(removed))
}

/** Mirror fast-glob's class loop: `^`/`!` negates, `-` is a range unless first, last, or escaped; `/` never matches. */
function parseClass(token: string): Ranges {
  const negated = /^\[[!^]/u.test(token)
  const members = token.slice(negated ? 2 : 1, -1).match(CHARACTER) ?? []
  const ranges: Ranges = []
  for (let i = 0; i < members.length; i += 1) {
    const low = codePoint(members[i])
    const ranged = members[i + 1] === '-' && i + 2 < members.length
    const high = ranged ? codePoint(members[i + 2]) : low
    if (low <= high) {
      ranges.push([low, high])
    }
    i += ranged ? 2 : 0
  }
  const set = merge(ranges)
  return subtract(negated ? complement(set) : set, SLASH)
}

function toRanges(unit: string): Ranges {
  if (unit === '?') {
    return ANY
  }
  return unit.startsWith('[') ? parseClass(unit) : [[codePoint(unit), codePoint(unit)]]
}

function escape(code: number, specials: Set<string>): string {
  const character = String.fromCodePoint(code)
  return specials.has(character) ? `\\${character}` : character
}

function formatMembers(ranges: Ranges): string {
  return ranges
    .map(([low, high]) => {
      const start = escape(low, CLASS_SPECIALS)
      const end = high - low > 1 ? `-${escape(high, CLASS_SPECIALS)}` : escape(high, CLASS_SPECIALS)
      return low === high ? start : start + end
    })
    .join('')
}

/** Emit the simplest unit for a set: nothing, a literal, `?`, or a class, negated when the set reaches the last byte. */
function formatRanges(ranges: Ranges): string[] {
  if (ranges.length === 0) {
    return []
  }
  if (ranges.length === 1 && ranges[0][0] === ranges[0][1]) {
    return [escape(ranges[0][0], LITERAL_SPECIALS)]
  }
  if (ranges.at(-1)?.[1] !== MAX_BYTE) {
    return [`[${formatMembers(ranges)}]`]
  }
  const excluded = subtract(complement(ranges), SLASH)
  return [excluded.length === 0 ? '?' : `[^${formatMembers(excluded)}]`]
}

function meetCharacters(left: string, right: string): string[] {
  return formatRanges(intersectRanges(toRanges(left), toRanges(right)))
}

const characters: Level = {
  star: '*',
  separator: '',
  split: tokenize,
  join: pattern => pattern,
  meet: meetCharacters
}

// A trailing `**` needs at least one segment in fast-glob, so `a/**` matches `a/` but not `a`: it is `**/*` inside the engine.
const segments: Level = {
  star: '**',
  separator: '/',
  split: pattern => pattern.replace(/(^|\/)\*\*$/u, '$1**/*').split('/'),
  join: pattern => pattern.replace(/(^|\/)\*\*\/\*$/u, '$1**'),
  meet: (left, right, budget) => intersectSequences(left, right, characters, budget)
}

function intersect(left: string, right: string, budget: Budget): string[] {
  return intersectSequences(left, right, segments, budget)
}

/** Suffixes carry a leading separator per unit, so an empty trailing segment stays distinct from no segment. */
function prepend(unit: string, suffix: string, level: Level): string {
  const { star, separator } = level
  const starred = separator + star
  if (unit === star && (suffix === starred || suffix.startsWith(starred + separator))) {
    return suffix
  }
  return separator + unit + suffix
}

function intersectSequences(
  leftPattern: string,
  rightPattern: string,
  level: Level,
  budget: Budget
): string[] {
  const { star, separator, split, join, meet } = level
  if (leftPattern === rightPattern || rightPattern === star) {
    return [leftPattern]
  }
  if (leftPattern === star) {
    return [rightPattern]
  }
  const left = split(leftPattern)
  const right = split(rightPattern)
  if (left.length + right.length > 2048) {
    throw new RangeError('Glob intersection depth limit exceeded')
  }
  const memo = new Map<number, string[]>()

  function visit(i: number, j: number): string[] {
    const key = i * (right.length + 1) + j
    const cached = memo.get(key)
    if (cached) {
      return cached
    }
    budget.step()
    const a = left.at(i)
    const b = right.at(j)
    const aStar = a === star
    const bStar = b === star
    const result = new Set<string>()
    if (i === left.length && j === right.length) {
      result.add('')
    }
    if (aStar) {
      for (const suffix of visit(i + 1, j)) {
        add(result, suffix, budget)
      }
    }
    if (bStar) {
      for (const suffix of visit(i, j + 1)) {
        add(result, suffix, budget)
      }
    }

    // Every edge advances a position except two stars consuming together; that self-loop is another star.
    if (aStar && bStar) {
      const looped = [...new Set([...result].map(suffix => prepend(star, suffix, level)))]
      memo.set(key, looped)
      return looped
    }
    if (a !== undefined && b !== undefined) {
      const units = aStar || bStar ? [aStar ? b : a] : meet(a, b, budget)
      for (const unit of units) {
        for (const suffix of visit(i + (aStar ? 0 : 1), j + (bStar ? 0 : 1))) {
          add(result, prepend(unit, suffix, level), budget)
        }
      }
    }
    const alternatives = [...result]
    memo.set(key, alternatives)
    return alternatives
  }

  return visit(0, 0).map(suffix => join(suffix.slice(separator.length)))
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

function toBytes(value: string): string {
  return Array.from(encoder.encode(value), byte => String.fromCodePoint(byte)).join('')
}

/** A UTF-8 glob cannot contain an isolated high byte. Classes can name it by excluding the other valid bytes. */
function serialize(pattern: string, budget: Budget): string[] {
  const decoded = decode(pattern)
  if (decoded !== undefined) {
    return [decoded]
  }
  const tokens = tokenize(pattern)
  let result = ['']
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    let alternatives = [decode(token)]
    if (!token.startsWith('[') && codePoint(token) >= 128) {
      let run = token
      while (
        i + 1 < tokens.length &&
        !tokens[i + 1].startsWith('[') &&
        codePoint(tokens[i + 1]) >= 128
      ) {
        run += tokens[++i]
      }
      const text = decode(run)
      if (text === undefined) {
        // Separate byte classes preserve constraints that stop halfway through a Unicode character.
        const members = tokenize(run).map(unit => byteClass(toRanges(unit), budget).at(0))
        alternatives = members.every(member => member !== undefined) ? [members.join('')] : []
      } else {
        alternatives = [text]
      }
    } else if (alternatives[0] === undefined) {
      alternatives = byteClass(toRanges(token), budget)
    }
    const next = new Set<string>()
    for (const prefix of result) {
      for (const suffix of alternatives) {
        if (suffix !== undefined) {
          add(next, prefix + suffix, budget)
        }
      }
    }
    result = [...next]
  }
  return result
}

function decode(bytes: string): string | undefined {
  try {
    return decoder.decode(Uint8Array.from(bytes, character => character.codePointAt(0) ?? 0))
  } catch {
    return undefined
  }
}

/** Cover a byte set with UTF-8 characters whose encoded bytes all belong to it. */
function byteMembers(bytes: Set<number>, budget: Budget): string | undefined {
  const members = new Set<string>()
  const covered = new Set<number>()
  // Continuation bytes are 128–191; valid leading bytes are 194–244.
  const continuation = [...bytes].filter(byte => byte >= 128 && byte <= 191)
  for (const byte of bytes) {
    budget.step()
    if (byte < 128) {
      members.add(escape(byte, CLASS_SPECIALS))
      covered.add(byte)
    }
  }
  for (const lead of bytes) {
    if (lead < 194 || lead > 244) {
      continue
    }
    const length = lead < 224 ? 2 : lead < 240 ? 3 : 4
    // These second-byte bounds exclude overlong encodings, surrogate code points, and values above U+10FFFF.
    const low = lead === 224 ? 160 : lead === 240 ? 144 : 128
    const high = lead === 237 ? 159 : lead === 244 ? 143 : 191
    const seconds = continuation.filter(byte => byte >= low && byte <= high)
    for (const byte of continuation) {
      if (!seconds.includes(byte) && (length === 2 || seconds.length === 0)) {
        continue
      }
      const sequence = [lead, seconds.includes(byte) ? byte : seconds[0]]
      while (sequence.length < length) {
        sequence.push(byte)
      }
      if (sequence.every(value => covered.has(value))) {
        continue
      }
      members.add(decoder.decode(new Uint8Array(sequence)))
      for (const value of sequence) {
        covered.add(value)
      }
    }
  }
  return [...bytes].every(byte => covered.has(byte)) ? [...members].join('') : undefined
}

function byteClass(ranges: Ranges, budget: Budget): string[] {
  // These are the only bytes that can occur in a JavaScript string encoded as UTF-8.
  const valid = Array.from({ length: 245 }, (_, byte) => byte).filter(
    byte => byte !== 47 && byte !== 192 && byte !== 193
  )
  const included = new Set(
    valid.filter(byte => ranges.some(([low, high]) => low <= byte && byte <= high))
  )
  const positive = byteMembers(included, budget)
  if (positive !== undefined) {
    return included.size === 0 ? [] : [`[${positive}]`]
  }
  const negative = byteMembers(new Set(valid.filter(byte => !included.has(byte))), budget)
  if (negative !== undefined) {
    return [`[^${negative}]`]
  }
  return [...included].flatMap(byte => byteClass([[byte, byte]], budget))
}
