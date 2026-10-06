import { expect, test } from 'vite-plus/test'

import { distribute } from '../src/index.js'

test('distribute reports that conversion is not implemented', () => {
  expect(() => {
    distribute()
  }).toThrow('Not implemented yet')
})
