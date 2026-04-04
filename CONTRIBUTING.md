# Contributing to Skynul Backend

Thanks for your interest in contributing! Here's how to get started.

## Getting started

```bash
git clone https://github.com/nevex-labs/skynul-backend.git
cd skynul-backend
pnpm install
pnpm dev
```

## Development workflow

1. **Fork** the repo and create a branch from `main`
2. **Make your changes** — keep them focused and minimal
3. **Run checks** before committing:
   ```bash
   pnpm typecheck    # type checking
   pnpm lint         # linting
   pnpm test:run     # tests
   ```
4. **Commit** with a clear message describing the change
5. **Open a Pull Request** against `main`

## Code style

- TypeScript strict mode
- [Biome](https://biomejs.dev) for formatting and linting — run `pnpm lint:fix` to auto-format
- No `any` types unless absolutely necessary
- Prefer `const` and arrow functions
- Keep files small and focused

## Commit messages

Use conventional-ish commits:

```
feat: add OpenRouter vision provider
fix: prevent race condition in browser singleton
refactor: extract agent loop from task-runner
test: add input-guard validation tests
docs: update API endpoint table
```

## Pull requests

- Keep PRs small — one concern per PR
- Include a clear description of what and why
- Add tests for new functionality
- Make sure all checks pass

## Reporting bugs

Open an issue with:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Node.js version and OS

## Adding a new LLM provider

1. Create `src/core/providers/your-provider.ts` extending `base-chat.ts`
2. Create `src/core/providers/your-provider-vision.ts` extending `base-vision.ts` (if it supports vision)
3. Add the provider ID to `ProviderId` in `src/shared/types/policy.ts`
4. Register it in `src/core/providers/dispatch.ts`
5. Add tests

## Adding a new messaging channel

1. Create `src/core/channels/your-channel.ts` implementing the channel interface
2. Register it in `src/core/channels/channel-manager.ts`
3. Add the channel ID to `ChannelId` in `src/shared/types/channel.ts`
4. Add tests

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
