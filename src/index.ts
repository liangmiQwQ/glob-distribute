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
  // Bound recursion depth independently of the configurable expansion budget, before `!` is collapsed.
  if (patterns.some(pattern => pattern.length > 512)) {
    throw new RangeError('Glob patterns must not exceed 512 UTF-16 code units')
  }
  const included: string[][] = []
  const excluded: string[] = []
  for (const pattern of new Set(patterns.map(stripNegation))) {
    const group = parse(pattern.replace(/^!/u, ''), budget)
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
  return [...output]
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

function tokenize(pattern: string): string[] {
  return pattern.match(/\\[\s\S]|[^]/gu) ?? []
}

/** Expand braces, then normalize each alternative. Returns deduplicated path patterns. */
function parse(pattern: string, budget: Budget): string[] {
  const tokens = tokenize(pattern)
  let position = 0

  function sequence(nested: boolean): string[] {
    let result = ['']
    while (position < tokens.length) {
      const token = tokens[position]
      if (nested && (token === ',' || token === '}')) {
        break
      }
      position += 1
      let alternatives = [token]
      if (token === '{') {
        const choices = new Set<string>()
        for (;;) {
          for (const choice of sequence(true)) {
            add(choices, choice, budget)
          }
          const separator = tokens[position++]
          if (separator === '}') {
            break
          }
          if (separator !== ',') {
            throw new SyntaxError('Unclosed brace in glob')
          }
        }
        alternatives = [...choices]
      } else if (['}', '[', ']', '(', ')', '!'].includes(token) || token === '\\') {
        throw new SyntaxError(`Unsupported or unescaped glob token: ${token}`)
      }
      const expanded = new Set<string>()
      for (const prefix of result) {
        for (const suffix of alternatives) {
          add(expanded, prefix + suffix, budget)
        }
      }
      result = [...expanded]
    }
    return result
  }

  return [...new Set(sequence(false).map(normalize))]
}

/** Resolve `**` the way standard globbers do: a whole segment spans directories, anywhere else it is `*`. */
function normalize(pattern: string): string {
  const segments: string[] = []
  for (const tokens of splitSegments(pattern)) {
    const segment =
      tokens.join('') === '**'
        ? '**'
        : tokens.filter((token, i) => token !== '*' || tokens[i - 1] !== '*').join('')
    if (segment !== '**' || segments.at(-1) !== '**') {
      segments.push(segment)
    }
  }
  return segments.join('/')
}

/** Split on `/`. Escaping a slash has no effect in a glob, so `\/` separates too. */
function splitSegments(pattern: string): string[][] {
  const segments: string[][] = [[]]
  for (const token of tokenize(pattern)) {
    if (token === '/' || token === String.raw`\/`) {
      segments.push([])
    } else {
      segments.at(-1)?.push(token)
    }
  }
  return segments
}

function meetCharacters(left: string, right: string): string[] {
  if (left === '?' || right === '?') {
    return [left === '?' ? right : left]
  }
  return left.replace(/^\\/u, '') === right.replace(/^\\/u, '') ? [left] : []
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
