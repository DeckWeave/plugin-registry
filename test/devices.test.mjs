import { test } from "node:test";
import assert from "node:assert/strict";
import { metadataErrors, validateRegistry } from "../bin/registry.mjs";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const data = JSON.parse(
  await readFile(new URL("../registry.json", import.meta.url), "utf8"),
);
test("typed v2 rejects action/device field mixing and version confusion", () => {
  assert.deepEqual(metadataErrors(data), []);
  for (const mutate of [
    (r) => (r.plugins[0].type = "device"),
    (r) => (r.plugins[4].controllers = ["Keypad"]),
    (r) => delete r.plugins[4].deviceProtocol,
    (r) => (r.plugins[4].deviceProtocol = 2),
    (r) =>
      (r.plugins[4].source.path =
        "../deckweave/plugins/dev.deckweave.mock.sdPlugin"),
    (r) => (r.schemaVersion = 1),
  ]) {
    const r = structuredClone(data);
    mutate(r);
    assert.ok(metadataErrors(r).length);
  }
});
test("device workspace validates actual manifest without requiring sibling repos or executing provider", async () => {
  const base = path.resolve(
      await mkdtemp(path.join(tmpdir(), "deckweave-device-registry-")),
    ),
    entry = structuredClone(data.plugins.find((p) => p.type === "device")),
    directory = path.join(base, "plugin-registry"),
    bundle = path.join(
      base,
      "plugin-template/examples",
      entry.id + ".dwDevice",
    );
  try {
    await mkdir(directory, { recursive: true });
    await mkdir(bundle, { recursive: true });
    const m = {
      kind: "device",
      protocol: 1,
      id: entry.id,
      name: entry.name,
      version: entry.version,
      runtime: "node",
      entry: "provider.mjs",
      models: entry.models,
      platforms: entry.platforms,
    };
    await writeFile(
      path.join(bundle, "deckweave.device.json"),
      JSON.stringify(m),
    );
    await writeFile(
      path.join(bundle, "provider.mjs"),
      'throw Error("validator must not execute me")',
    );
    let result = await validateRegistry(
      { schemaVersion: 2, plugins: [entry] },
      { directory, workspace: true },
    );
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
    m.runtime = "native";
    m.entry = "provider.exe";
    await writeFile(
      path.join(bundle, "provider.exe"),
      "inert fixture bytes, never execute",
    );
    await writeFile(
      path.join(bundle, "deckweave.device.json"),
      JSON.stringify(m),
    );
    result = await validateRegistry(
      { schemaVersion: 2, plugins: [entry] },
      { directory, workspace: true },
    );
    assert.deepEqual(result.errors, []);
    m.args = ["--arbitrary"];
    await writeFile(
      path.join(bundle, "deckweave.device.json"),
      JSON.stringify(m),
    );
    result = await validateRegistry(
      { schemaVersion: 2, plugins: [entry] },
      { directory, workspace: true },
    );
    assert.match(result.errors.join("\n"), /unknown field args/);
    delete m.args;
    m.entry = "../outside.exe";
    await writeFile(
      path.join(bundle, "deckweave.device.json"),
      JSON.stringify(m),
    );
    result = await validateRegistry(
      { schemaVersion: 2, plugins: [entry] },
      { directory, workspace: true },
    );
    assert.match(result.errors.join("\n"), /entry: invalid format/);
  } finally {
    assert.equal(path.dirname(base), path.resolve(tmpdir()));
    assert.ok(path.basename(base).startsWith("deckweave-device-registry-"));
    await rm(base, { recursive: true, force: true });
  }
});
