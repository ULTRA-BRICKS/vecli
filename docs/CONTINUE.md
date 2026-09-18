# Continuation checkpoint — 2026-09-18

Source: private https://git.hyperide.ai/ultrabricks/vecli, branch feat/UB-20-standalone-parametric-source. Imported upstream path history main2fc2d8e;217 current file SHA matches and110 selected history commits documented in EXTRACTION.json. No unrelated source or credentials imported; inherited Elastic-2.0 retained.

Standalone packages installed using hoisted linker to resolve ink-testing-library missing undeclared ink dependency. A clean install passed860 tests before portable facade additions. New parser supports param, calls/modifiers, named arguments, modules, loops and arithmetic; it emits a host-schema canonical DAG and exact source locations. No eval/Function. Printer retains edge IDs and literal binding fallbacks. Geometry facade is the actual vector-engine generator/path implementation, adds bounded browser-safe entrypoint. Fixed truncated/NaN path decoding upstream with a failing regression.

Editor consumer is a separate repo/worktree /Users/ultra/work/image-editor-workbench-20260918. It currently uses a temporary local vendor/vecli symlink for active development only; must replace by pinned genuine git submodule after this upstream commit is pushed. HyperIDE migration not yet executed; preserve all original worktrees. Upstream task UB-20; editor issues27–30 must not be mirrored here.

Next: full test+portable typecheck; scoped complete review and fix; commit/push PR; bootstrap downstream git submodule with compatibility paths/workspaces and validate.

Review follow-up: sticky lexer (no suffix-copy loop), occupied-input index, pre-indexed printer edges, clone defaults only for objects, central generator radius (rounded-rect facade no longer duplicates geometry). Existing raw arc/spiral direct-call API defaults retained deliberately; GraphExecutor also normalizes all surfaces. Existing engine↔WASM circular package decomposition remains a separately tracked upstream architectural task, not silently hidden.
