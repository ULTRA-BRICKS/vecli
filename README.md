# vecli

Standalone parametric vector toolkit extracted from HyperIDE into the Ultrabricks organization. Includes `vector-cli`, `vector-engine`, `vector-wasm`; all source stays in this repository. HyperIDE and other products consume a pinned submodule/package, not diverging copies.

```sh
bun install --frozen-lockfile
bun test packages
bun packages/vector-cli/bin/vecli.ts 'rect(100,60).fill("#336699")'
```

Source provenance and preserved-history checks: [docs/EXTRACTION.json](docs/EXTRACTION.json). Inherited source remains **Elastic-2.0**, not MIT; this is not an OSI-open-source licensing claim. No release/deployment authority or relicensing of third-party contributions is inferred from moving repositories.

Backlog: tasks-app / Ultrabricks / vecli (`UB-1` through `UB-18`, extraction `UB-20`). The independent graphics editor uses its own tracker.
