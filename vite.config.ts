import { liangmi } from '@liangmi/vp-config'

export default await liangmi({
  pack: { entry: './src/index.js' },
  // Allow scaffold validation until the conversion behavior has tests.
  test: { passWithNoTests: true }
})
