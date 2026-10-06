# glob-distribute Agent Guide

This package is intended to convert glob AND expressions into OR alternatives.
It is currently a scaffold: agree on glob syntax and conversion semantics before adding a public API.

## Toolchain

Vite+ is used as the project manager and dev toolchain for JavaScript part. Check `node_modules/vite-plus/docs` if you don't know how to use Vite+ features. When you find yourself needing a dev tool a tool is missing, you can check Vite+'s document first.

## Rules

Keep JavaScript dependency versions in the default catalog in `pnpm-workspace.yaml`, and reference them with `catalog:` in package manifests.

As a opensource project, not all contributors are required to install Vite+ as `vp` globally, so when you are adding a script / task, using `package.json#scripts` to ensure the accessiblility for external contributors.

## Development

- Source code is JavaScript with TypeScript checking; keep the public entry in `src/index.js`.
- Run `pnpm check`, `pnpm build`, and `pnpm test` before committing.
- No tests exist yet. Remove `test.passWithNoTests` when adding the first behavioral tests.
- Keep functions small and exports limited to the public API.
- Use Conventional Commits for commit messages and PR titles.
- Do not use git worktrees unless the user requests one.
