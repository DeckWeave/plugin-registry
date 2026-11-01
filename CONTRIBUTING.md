# Contributing a plugin entry

1. Create the plugin from the sibling `plugin-template` or provide a complete reviewed bundle. Use your own reverse-DNS namespace and unique action UUIDs. Describe what key, dial and Panel input does; support only controllers actually implemented.
2. Document settings, background work, network endpoints/data disclosure, native helpers, platform limitations, errors, cancellation and licensing in the plugin README. Keep all required source/notices with GPL distributions. Do not copy third-party installed Elgato packages into this repository.
3. Add an optional entry with the actual version, manifest name and controller union. Current workspace entries are confined to the sibling application's plugins directory. Do not add empty icon packs or internal testing fixtures as useful plugins.
4. For native files, declare `requiredFiles` here and `DeckWeave.RequiredFiles` in the plugin manifest. A developer checkout's target-directory fallback is not a substitute for a bundled release helper.
5. Run `npm test`, `npm run validate`, and, when the sibling checkout is available, `npm run validate:workspace`. Before distributing a workspace bundle, run `node bin/registry.mjs validate --packaging` and the plugin's tests/package checks. Do not change user device assignments as part of registry validation.
6. A published archive entry requires an actual release asset, HTTPS URL, concrete version and SHA-256 of those final bytes. Do not invent remote URLs or use sample/repeated placeholder hashes. Preserve old released bytes; a changed archive needs a new version and registry review. The CLI does not download, publish, install or execute anything.

PR descriptions should state the plugin's concrete use, controller/platform coverage, network/OS effects, license, validation performed and remaining physical acceptance. Registry changes need maintainer review; a structurally valid entry is not an endorsement of arbitrary code.

For tool changes, add tests that reject malformed sources, traversal and mismatched manifests, and preserve isolated-clone validation. Keep the JSON Schema and built-in validator vocabulary synchronized. CI uses Node 22 without dependency installation. Never add credentials or machine-specific absolute paths to metadata.
