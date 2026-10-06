# Contributing Guide

Thank you! We are so excited that you are interested in our project and would like to contribute. Before starting your contribution, please take a moment to read the following tips to save time.

## Before Contributing

Before opening an issue or submitting a pull request, please make sure your problem description is clear and includes necessary steps to reproduce, expected behavior, and actual results.

Please check existing issues and pull requests to avoid duplicates. Use the search function to see if similar topics have been discussed before.

For new feature proposals, please open an Issue or start a Discussion first to gather feedback from maintainers and the community before implementing.

## Setup Project

Use the Node.js version in `.node-version` and the pnpm version in `package.json`.

```sh
pnpm install
pnpm check
pnpm build
pnpm test
```

Vite+ is installed locally; a global `vp` installation is optional.
The test command currently permits an empty suite because conversion logic is not implemented.

### Releases

Configure [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for `liangmiQwQ/glob-distribute`, workflow `release.yml`, before the first automated publish. The npm package must exist before its trusted publisher can be configured, so the initial publish requires an authenticated maintainer.

Run `pnpm release` to bump the version, commit, and push a `v*` tag. The tag triggers the release workflow, which validates and builds the package, generates GitHub release notes, and publishes to npm.
Do not release the scaffold; implement and test the conversion API first.

## Creating Pull Request

We will review your PR and ensure CI passes (if available)

Before submitting your pull request:

1. Ensure all tests pass
2. Verify code meets linting standards
3. Update documentation if necessary
4. Add tests for new functionality

We typically use squash and merge to keep the commit history clean. Please ensure your PR contains logically grouped changes.

Your PR title should follow [conventional commit format](https://www.conventionalcommits.org/en/v1.0.0/), for example:

- `feat: add user authentication`
- `fix: resolve memory leak in data processor`
- `docs: update API documentation`

If your PR hasn't been reviewed within two weeks, please:

- Mention relevant maintainers using `@liangmiQwQ`
- Or contact us at `github@liangmi.dev`

## Possible Follow-up Actions

If reviewers request changes:

1. Convert your PR to a draft: This indicates it's not ready for review
2. Make the requested changes
3. Convert back to "Ready for Review" when done

You can push additional commits to your existing branch - there's no need to create a new pull request. We'll see your updates automatically.

Thank you for contributing! 🎉
