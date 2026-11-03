import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  metadataErrors,
  validateRegistry,
  schemaErrors,
  schema,
} from "../bin/registry.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = () => ({
  id: "dev.test.counter",
  name: "Counter",
  version: "0.1.0",
  license: "GPL-3.0-or-later",
  description: "Test fixture, not a published plugin",
  source: {
    kind: "workspace",
    path: "../deckweave/plugins/dev.test.counter.sdPlugin",
  },
  controllers: ["Keypad"],
  platforms: ["windows"],
  optional: true,
});
const registry = (plugin = entry()) => ({
  schemaVersion: 1,
  plugins: [plugin],
});
test("checked-in metadata validates without sibling repositories", async () => {
  const data = JSON.parse(
    await readFile(path.join(root, "registry.json"), "utf8"),
  );
  assert.deepEqual(metadataErrors(data), []);
  assert.equal(data.schemaVersion, 2);
  for (const id of ["weather", "audio", "monitor", "timers", "desktop", "clock", "focus", "workspace"]) {
    assert.ok(data.plugins.some((p) => p.id === `dev.deckweave.${id}` && p.type === "action"), id);
  }
  assert.equal(data.plugins.filter((p) => p.type === "device").length, 1);
  const audio = data.plugins.find((p) => p.id === "dev.deckweave.audio");
  assert.ok(
    audio.requiredFiles.some((f) => f.path === "bin/deckweave-system.exe"),
  );
});
test("schema rejects unknown fields, unsupported controllers, malformed source and traversal", () => {
  for (const mutate of [
    (r) => (r.extra = true),
    (r) => (r.constructor = "unexpected field"),
    (r) => (r.plugins[0].controllers = ["Knob"]),
    (r) => (r.plugins[0].source.path = "../../outside"),
    (r) =>
      (r.plugins[0].source.path =
        "../deckweave/plugins/../dev.test.counter.sdPlugin"),
    (r) => (r.plugins[0].source.kind = "script"),
    (r) => delete r.plugins[0].license,
  ]) {
    const r = registry();
    mutate(r);
    assert.ok(metadataErrors(r).length, JSON.stringify(r));
  }
  for (const name of [
    "../x",
    "bin/../x",
    "C:/x",
    "bin\\x",
    "/root/x",
    "bin/x:secret",
    "bin/./x",
    "bin/\0x",
  ])
    assert.ok(schemaErrors(name, schema.$defs.relativeFile).length, name);
});
test("unique IDs, paths matching IDs and platform requirements are enforced", () => {
  const r = registry();
  r.plugins.push(structuredClone(r.plugins[0]));
  assert.match(metadataErrors(r).join("\n"), /duplicate plugin ID/);
  const mismatch = registry();
  mismatch.plugins[0].source.path =
    "../deckweave/plugins/dev.other.counter.sdPlugin";
  assert.match(metadataErrors(mismatch).join("\n"), /match the plugin ID/);
  const platforms = registry();
  platforms.plugins[0].requiredFiles = [
    { path: "helper", platforms: ["linux"] },
  ];
  assert.match(metadataErrors(platforms).join("\n"), /outside supported/);
});
test("archive metadata is HTTPS and checksum-pinned; placeholder hashes and unsafe URLs fail", () => {
  const plugin = entry();
  plugin.source = {
    kind: "archive",
    url: "https://example.invalid/releases/v0.1.0/counter.zip",
    sha256: createHash("sha256")
      .update("synthetic fixture archive bytes")
      .digest("hex"),
  };
  assert.deepEqual(metadataErrors(registry(plugin)), []);
  for (const mutate of [
    (p) => (p.source.url = "http://example.invalid/file.zip"),
    (p) => (p.source.url = "https://user:secret@example.invalid/file.zip"),
    (p) => (p.source.url += "?token=secret"),
    (p) => (p.source.url = "https://example.invalid/releases/%2e%2e/file.zip"),
    (p) => (p.source.sha256 = "0".repeat(64)),
    (p) => (p.source.sha256 = "deadbeef".repeat(8)),
    (p) => (p.source.sha256 = "TODO"),
  ]) {
    const copy = structuredClone(plugin);
    mutate(copy);
    assert.ok(metadataErrors(registry(copy)).length, JSON.stringify(copy));
  }
});
async function fixture(fn) {
  const base = path.resolve(
    await mkdtemp(path.join(tmpdir(), "deckweave-registry-")),
  );
  const directory = path.join(base, "plugin-registry"),
    bundle = path.join(base, "deckweave/plugins/dev.test.counter.sdPlugin");
  try {
    await mkdir(directory, { recursive: true });
    await mkdir(bundle, { recursive: true });
    const manifest = {
      UUID: "dev.test.counter",
      Name: "Counter",
      Version: "0.1.0",
      CodePath: "plugin.mjs",
      PropertyInspectorPath: "settings.html",
      Actions: [{ UUID: "dev.test.counter.run", Controllers: ["Keypad"] }],
    };
    await writeFile(
      path.join(bundle, "manifest.json"),
      JSON.stringify(manifest),
    );
    await writeFile(
      path.join(bundle, "plugin.mjs"),
      'throw new Error("validation must never execute this file")',
    );
    await writeFile(
      path.join(bundle, "settings.html"),
      "not loaded by validator",
    );
    await fn({ base, directory, bundle, manifest });
  } finally {
    assert.equal(path.dirname(base), path.resolve(tmpdir()));
    assert.ok(path.basename(base).startsWith("deckweave-registry-"));
    await rm(base, { recursive: true, force: true });
  }
}
test("workspace checks actual manifests/entries while metadata validation never reads or executes a plugin", async () =>
  fixture(async ({ directory, bundle, manifest }) => {
    assert.deepEqual(
      (await validateRegistry(registry(), { directory, workspace: true }))
        .errors,
      [],
    );
    manifest.Version = "0.2.0";
    await writeFile(
      path.join(bundle, "manifest.json"),
      JSON.stringify(manifest),
    );
    assert.match(
      (
        await validateRegistry(registry(), { directory, workspace: true })
      ).errors.join("\n"),
      /Version mismatch/,
    );
    assert.deepEqual(
      (await validateRegistry(registry(), { directory })).errors,
      [],
    );
    manifest.Version = "0.1.0";
    manifest.CodePath = "../outside.mjs";
    await writeFile(
      path.join(bundle, "manifest.json"),
      JSON.stringify(manifest),
    );
    assert.match(
      (
        await validateRegistry(registry(), { directory, workspace: true })
      ).errors.join("\n"),
      /unsafe relative/,
    );
  }));
test("missing native helper warns for source check and fails packaging preflight", async () =>
  fixture(async ({ directory, bundle }) => {
    const r = registry();
    r.plugins[0].requiredFiles = [
      { path: "bin/helper.exe", platforms: ["windows"] },
    ];
    const source = await validateRegistry(r, { directory, workspace: true });
    assert.deepEqual(source.errors, []);
    assert.equal(source.warnings.length, 1);
    assert.match(
      (await validateRegistry(r, { directory, packaging: true })).errors.join(
        "\n",
      ),
      /required distribution file/,
    );
    await mkdir(path.join(bundle, "bin"));
    await writeFile(
      path.join(bundle, "bin/helper.exe"),
      "fixture bytes, never executed",
    );
    assert.deepEqual(
      (await validateRegistry(r, { directory, packaging: true })).errors,
      [],
    );
  }));
test("entry points escaping through directory symlinks/junctions are rejected", async (t) =>
  fixture(async ({ directory, bundle, base, manifest }) => {
    const outside = path.join(base, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "plugin.mjs"), "never execute");
    try {
      await symlink(
        outside,
        path.join(bundle, "linked"),
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (["EPERM", "EACCES"].includes(error.code)) {
        t.skip("environment does not allow creating symlinks");
        return;
      }
      throw error;
    }
    manifest.CodePath = "linked/plugin.mjs";
    await writeFile(
      path.join(bundle, "manifest.json"),
      JSON.stringify(manifest),
    );
    assert.match(
      (
        await validateRegistry(registry(), { directory, workspace: true })
      ).errors.join("\n"),
      /escapes bundle/,
    );
  }));
test("CLI has predictable failure status and refuses incomplete flags", () => {
  const result = spawnSync(
    process.execPath,
    ["bin/registry.mjs", "validate", "--file"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /incomplete option/);
});
