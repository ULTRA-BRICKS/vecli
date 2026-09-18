# vecli contributor rules

Canonical source: git.hyperide.ai/ultrabricks/vecli. Owner tasks: tasks-app team UB / project vecli. Do not place unrelated graphics-editor tasks here; that app has its own GitHub tracker.

The three original vector packages were extracted with selected Git history, original authors and unmodified license. See docs/EXTRACTION.json. Retain Elastic-2.0 notices; no blanket MIT/OSS claim or unapproved relicensing. Dependencies retain their own licenses.

Use failing tests first for defects; run engine/CLI/WASM tests from the standalone root. Do not silently use MockPathOps in a product surface. Parameterized source, graph and operation history must stay explicit; no new Function/eval for untrusted code. The inherited legacy JS CLI currently has known issues tracked UB-2..UB-18; do not mistake extraction for fixing all of them. New host-independent APIs must not import UI, telemetry, secrets, HyperIDE or Node-only modules.

Review before commits and record actual tests/output. Keep git changes scoped and preserve other worktrees. Do not auto-update downstream submodule pins; change them with a reviewed compatibility test.
