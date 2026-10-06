export interface DistributeOptions {
  /** Maximum alternatives in any intermediate or final union. Default: 10,000. */
  maxResults?: number
  /** Maximum expansion and intersection steps per call. Default: 100,000. */
  maxOperations?: number
}

interface Budget {
  maxResults: number
  step: () => void
}

/** Return glob alternatives matching every input pattern. No filesystem access is performed. */
export function distribute(patterns: readonly string[], options: DistributeOptions = {}): string[] {
  const budget = createBudget(options)
  if (!Array.isArray(patterns) || patterns.some(pattern => typeof pattern !== 'string')) {
    throw new TypeError('Expected an array of glob strings')
  }

  // 1. Parse every input before intersecting so invalid syntax never depends on input order.
  const included: string[][][] = []
  const excluded: string[][] = []
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
      const leftTokens = tokenize(left)
      for (const right of group) {
        budget.step()
        for (const pattern of intersect(leftTokens, right, budget)) {
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
  const kept = result.filter(
    pattern => !excluded.some(negated => covers(negated, tokenize(pattern), budget))
  )
  const negations = [...new Set(excluded.map(negated => negated.join('')))].filter(negated =>
    kept.some(pattern => intersect(tokenize(pattern), tokenize(negated), budget).length > 0)
  )
  return [...kept, ...negations.map(negated => `!${negated}`)]
}

/** Collapse leading `!` so `!!a` is `a`, and `!!!a` is `!a`. */
function stripNegation(pattern: string): string {
  const body = pattern.replace(/^!+/u, '')
  return (pattern.length - body.length) % 2 === 0 ? body : `!${body}`
}

/** Whether `pattern` is contained in `negated`, so every string it matches is excluded. */
function covers(negated: string[], pattern: string[], budget: Budget): boolean {
  return intersect(pattern, negated, budget).includes(pattern.join(''))
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
    maxResults,
    step() {
      operations += 1
      if (operations > maxOperations) {
        throw new RangeError('Glob operation limit exceeded')
      }
    }
  }
}

function add(target: Set<string>, value: string, budget: Budget): void {
  budget.step()
  target.add(value)
  if (target.size > budget.maxResults) {
    throw new RangeError('Glob alternative limit exceeded')
  }
}

function tokenize(pattern: string): string[] {
  return pattern.match(/\\[\s\S]|\*\*|[^]/gu) ?? []
}

function parse(pattern: string, budget: Budget): string[][] {
  // Bound recursion depth independently of the configurable expansion budget.
  if (pattern.length > 512) {
    throw new RangeError('Glob patterns must not exceed 512 UTF-16 code units')
  }
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

  return [...new Set(sequence(false).map(value => normalize(tokenize(value))))].map(tokenize)
}

function isStar(token: string | undefined): boolean {
  return token === '*' || token === '**'
}

function prepend(token: string, suffix: string): string {
  if (isStar(token) && suffix.startsWith('*')) {
    const length = suffix.startsWith('**') ? 2 : 1
    return (token === '**' || length === 2 ? '**' : '*') + suffix.slice(length)
  }
  return token + suffix
}

function normalize(tokens: string[]): string {
  let result = ''
  for (const token of tokens.toReversed()) {
    result = prepend(token, result)
  }
  return result
}

function characterIntersection(left: string, right: string): string | undefined {
  const leftWildcard = isStar(left) || left === '?'
  const rightWildcard = isStar(right) || right === '?'
  if (!leftWildcard && !rightWildcard) {
    return left.replace(/^\\/u, '') === right.replace(/^\\/u, '') ? left : undefined
  }
  if (leftWildcard && rightWildcard) {
    return '?'
  }
  const literal = leftWildcard ? right : left
  const wildcard = leftWildcard ? left : right
  return literal.replace(/^\\/u, '') !== '/' || wildcard === '**' ? literal : undefined
}

function intersect(left: string[], right: string[], budget: Budget): string[] {
  const leftPattern = left.join('')
  const rightPattern = right.join('')
  if (leftPattern === rightPattern || rightPattern === '**') {
    return [leftPattern]
  }
  if (leftPattern === '**') {
    return [rightPattern]
  }
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
    const aStar = isStar(a)
    const bStar = isStar(b)
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
      const loop = a === '**' && b === '**' ? '**' : '*'
      const looped = [...new Set([...result].map(suffix => prepend(loop, suffix)))]
      memo.set(key, looped)
      return looped
    }
    if (a !== undefined && b !== undefined) {
      const token = characterIntersection(a, b)
      if (token !== undefined) {
        for (const suffix of visit(i + (aStar ? 0 : 1), j + (bStar ? 0 : 1))) {
          add(result, prepend(token, suffix), budget)
        }
      }
    }
    const alternatives = [...result]
    memo.set(key, alternatives)
    return alternatives
  }

  return visit(0, 0)
}
