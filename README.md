# DeckWeave optional plugin registry

A small, validated metadata catalog for optional action plugins. It contains **Weather, Audio, System Monitor and Timers**, all GPL-3.0-or-later. Current entries point to the sibling application source checkout; no remote release URLs or downloadable releases are invented. Third-party Elgato packages and empty icon packs are not redistributed here.

This is **not an installer or Marketplace**. The tools read JSON and local files; they never download, run a plugin, install dependencies or modify application settings. The development host currently discovers `deckweave/plugins` directly. Changing this registry does not install or enable a plugin in the app.

## Quick start

Node.js 22+; no npm install or dependencies needed:

```powershell
npm test
npm run validate
npm run validate:workspace
node bin/registry.mjs validate --packaging
```

| Command | What it checks |
|---|---|
| `validate` | Checked-in JSON Schema plus duplicate IDs, matching paths, URL/checksum rules and required-file platforms. Works in an isolated clone |
| `validate --workspace` | Also reads sibling bundles, manifest identity/version/name, entry points, action namespaces and controller union. Missing distribution helpers produce a warning, because a source checkout may have a documented build-output fallback |
| `validate --packaging` | Implies workspace checking; missing required native files are an error. This is a preflight, not an archive builder |
| `validate --file <path>` | Use another registry JSON; workspace paths are relative to that file's directory |

`npm test` uses its own temporary fixtures; their backends deliberately throw if executed, so successful validation cannot rely on running a plugin. CI runs tests and metadata validation on Windows and Linux with Node 22. Actual host/device support is currently listed as Windows; schema also allows macOS/Linux for future verified releases. Local checks on this machine used Node 26; CI is configured for Node 22, not claimed to have run remotely.

По-русски: `npm run validate` проверяет только реестр. `npm run validate:workspace` дополнительно проверяет плагины из соседнего `deckweave/plugins`. Перед распространением используйте `node bin/registry.mjs validate --packaging`: отсутствие обязательного нативного файла остановит проверку.

## Entry contract

See [registry.json](registry.json), [JSON Schema](schema/registry.schema.json) and [contribution guide](CONTRIBUTING.md). Fields are explicit: reverse-DNS `id`, display `name`, concrete `version`, license identifier, description, controllers, supported platforms, `optional:true`, and exactly one source shape. IDs are unique across the registry. Platform/controller arrays cannot be empty or duplicated. Unknown fields fail validation so typos do not silently change meaning. License strings have SPDX identifier syntax; maintainers must still verify the actual license and bundled notices.

### Development workspace source

`source.kind` is `workspace`; `source.path` must be exactly `../deckweave/plugins/<id>.sdPlugin`. Only this reviewed sibling boundary is allowed; arbitrary `..`, absolute paths, alternate drives and symlink escapes are rejected. Workspace references are development-only and should not be presented as remotely installable entries.

### Published archive source

`source.kind` is `archive`, with `url` and lowercase 64-hex `sha256` instead of `path`. The URL must be an HTTPS ZIP release asset without credentials, query strings, fragments or an explicit port. A source-specific immutable release URL should identify the same concrete version as the entry. SHA-256 pins the exact archive bytes, including when a server later replaces them; placeholder/repeated-pattern checksums are rejected. A real checksum does not prove authorship or safety.

To add a published entry, first create and review the actual release archive, compute its hash with `Get-FileHash -Algorithm SHA256 <archive>` or the template's generated `.sha256` file, publish that exact asset, then add its real HTTPS URL and digest in a reviewed change. No published archive entries exist yet. The validator checks **metadata only** for archives and never fetches or inspects them. A future installer must verify bytes before extraction and defend against archive traversal/symlinks separately; no such installer is shipped here.

## Native distribution files

`requiredFiles` declares bundled relative files with their supported `platforms`. Audio requires `bin/deckweave-system.exe` on Windows. Its source checkout can use a locally built helper from `target/release` or `target/debug`, but that fallback does not make a distributable self-contained. `--packaging` rejects a missing bundled helper. The corresponding plugin manifest declares `DeckWeave.RequiredFiles`; the template packager enforces those paths when building an archive. Keep the manifest and registry declarations synchronized.

The helper is built by the application repository; this registry does not build or execute it. Read the Audio plugin README for build instructions and its exact OS behavior. Packaging tools must include all required files and their licenses, then compute the hash from the final archive.

## Validator scope

The bundled validator implements only the JSON Schema vocabulary used by this repository's schema. It is not a general JSON Schema library. Editors may use a full Draft 2020-12 implementation; cross-entry uniqueness, ID/path correspondence, checksum quality and filesystem containment are additional CLI checks. Validation proves structural consistency, not runtime correctness, permission review or compatibility with every Elgato feature.
