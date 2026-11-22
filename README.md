# mend-cli-champion

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/thedevanshshukla/mend-cli-champion/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/thedevanshshukla/mend-cli-champion/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

`mend` is a robust, deterministic command-line patch tool that applies AI-generated edits in four formats to a tree of text files:
1. **Unified diffs** (including offset line numbers, git renames, creations, deletions, and trailing EOF newline handling)
2. **SEARCH/REPLACE blocks** (with markdown fences, whitespace variations, and multi-block edits)
3. **V4A patches** (chunk anchors, cursor movement, file moves, and EOF anchoring)
4. **JSON text-editor tool calls** (`create`, `str_replace`, `insert`)

Built for make.fun's [Build mend, one patch tool for every AI edit format](https://make.fun/bounty/hidden-spec-cli-01-run-20261122) bounty ($100 pool).

## Highlights
- **Multi-tiered Matching**: Three-tier matching (Tier 0 exact, Tier 1 trailing whitespace stripped, Tier 2 leading & trailing whitespace stripped with automatic re-indentation).
- **Safe Path Validation**: Rejects path traversal, absolute paths, and empty or malformed path components before any file operations.
- **Atomic Operations**: All-or-nothing execution ensures files are only written when every edit succeeds cleanly.
- **Deterministic**: Pure Node.js 22 standard library implementation with zero external dependencies.

## Usage
```bash
node main.ts [--format=NAME] [--check] [--strict] [PATCH]
```

## License
MIT (see [LICENSE](LICENSE)).
