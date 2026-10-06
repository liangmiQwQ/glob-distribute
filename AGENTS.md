# glob-distribute Agent Guide

glob-distribute converts glob AND expressions into OR alternatives for tools that consume glob patterns.

## Toolchain

Vite+ is used as the project manager and dev toolchain for JavaScript part. Check `node_modules/vite-plus/docs` if you don't know how to use Vite+ features. When you find yourself needing a dev tool a tool is missing, you can check Vite+'s document first.

Source code is JavaScript with TypeScript checking; keep the public entry in `src/index.js`.

## Rules

Keep JavaScript dependency versions in the default catalog in `pnpm-workspace.yaml`, and reference them with `catalog:` in package manifests.

As a opensource project, not all contributors are required to install Vite+ as `vp` globally, so when you are adding a script / task, using `package.json#scripts` to ensure the accessiblility for external contributors.

Do not use git worktrees unless the user requests one.

If you find AGENTS.md is outdated, please notice users to change in response.

Keep code functional. Write simple code that junior developers can understand, and make functions reusable if possible. Use Unix philosophy to design your code (Every function should only do one thing and should not be too long or complex).

Use existing dependencies and tools. Feel free to add dependencies. Don't reinvent the wheel.

Commit messages and PR titles follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

Add `.gitkeep` file when creating new empty directory.
