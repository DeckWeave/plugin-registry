#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const schema = JSON.parse(
  await readFile(path.join(root, "schema/registry.schema.json"), "utf8"),
);
const deviceManifestSchema = JSON.parse(
  await readFile(path.join(root, "schema/device-manifest.schema.json"), "utf8"),
);

// Implements only the schema vocabulary used by the checked-in schema, not general JSON Schema.
export function schemaErrors(value, rule = schema, location = "$") {
  if (rule.$ref)
    return schemaErrors(
      value,
      rule.$ref
        .split("/")
        .slice(1)
        .reduce((n, key) => n[key], schema),
      location,
    );
  const errors = [],
    fail = (message) => errors.push(`${location}: ${message}`);
  if (rule.oneOf) {
    const matches = rule.oneOf.filter(
      (r) => schemaErrors(value, r, location).length === 0,
    );
    if (matches.length !== 1)
      fail("does not match exactly one allowed source shape");
    return errors;
  }
  if ("const" in rule && value !== rule.const)
    fail(`expected ${JSON.stringify(rule.const)}`);
  if (rule.enum && !rule.enum.includes(value)) fail("unsupported value");
  if (rule.type) {
    const valid =
      rule.type === "array"
        ? Array.isArray(value)
        : rule.type === "object"
          ? value !== null && typeof value === "object" && !Array.isArray(value)
          : typeof value === rule.type;
    if (!valid) {
      fail(`expected ${rule.type}`);
      return errors;
    }
  }
  if (typeof value === "string") {
    if (rule.minLength && value.length < rule.minLength) fail("too short");
    if (rule.maxLength && value.length > rule.maxLength) fail("too long");
    if (rule.pattern && !new RegExp(rule.pattern).test(value))
      fail("invalid format");
  }
  if (Array.isArray(value)) {
    if (rule.minItems && value.length < rule.minItems) fail("too few items");
    if (
      rule.uniqueItems &&
      new Set(value.map((v) => JSON.stringify(v))).size !== value.length
    )
      fail("duplicate items");
    if (rule.items)
      value.forEach((item, index) =>
        errors.push(...schemaErrors(item, rule.items, `${location}[${index}]`)),
      );
  } else if (value && typeof value === "object") {
    for (const key of rule.required ?? [])
      if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(rule.properties ?? {}, key))
        errors.push(
          ...schemaErrors(item, rule.properties[key], `${location}.${key}`),
        );
      else if (rule.additionalProperties === false)
        fail(`unknown field ${key}`);
    }
  }
  return errors;
}
const within = (parent, file) =>
  file !== parent && file.startsWith(parent + path.sep);
export function metadataErrors(registry) {
  const errors = schemaErrors(registry);
  if (errors.length) return errors;
  const ids = new Set();
  for (const entry of registry.plugins) {
    const prefix = entry.id;
    if (ids.has(entry.id)) errors.push(`${prefix}: duplicate plugin ID`);
    ids.add(entry.id);
    if (!entry.name.trim() || !entry.description.trim())
      errors.push(`${prefix}: name/description cannot be whitespace`);
    if (
      entry.source.kind === "workspace" &&
      entry.source.path !==
        (entry.type === "device"
          ? `../plugin-template/examples/${entry.id}.dwDevice`
          : `../deckweave/plugins/${entry.id}.sdPlugin`)
    )
      errors.push(`${prefix}: workspace path must match the plugin ID`);
    if (entry.source.kind === "archive") {
      try {
        const rawPath = entry.source.url
          .slice("https://".length)
          .replace(/^[^/]+/, "");
        if (
          decodeURIComponent(rawPath)
            .split("/")
            .some((part) => part === ".." || part === ".") ||
          /[\\\x00-\x20]/.test(entry.source.url)
        )
          throw new Error("unsafe URL path");
        const url = new URL(entry.source.url);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          url.port ||
          url.pathname
            .split("/")
            .some((part) => decodeURIComponent(part) === "..")
        )
          throw new Error("unsupported URL");
      } catch {
        errors.push(
          `${prefix}: archive URL must be an HTTPS ZIP without credentials, query, fragment or explicit port`,
        );
      }
      for (let length = 1; length <= 16; length++)
        if (
          64 % length === 0 &&
          entry.source.sha256 ===
            entry.source.sha256.slice(0, length).repeat(64 / length)
        ) {
          errors.push(`${prefix}: placeholder checksum is forbidden`);
          break;
        }
    }
    const required = new Set();
    for (const file of entry.requiredFiles ?? []) {
      if (required.has(file.path))
        errors.push(`${prefix}: duplicate required file`);
      required.add(file.path);
      if (
        file.platforms.some((platform) => !entry.platforms.includes(platform))
      )
        errors.push(
          `${prefix}: required file platform is outside supported platforms`,
        );
    }
  }
  return errors;
}
async function fileInside(base, relative) {
  const errors = schemaErrors(relative, schema.$defs.relativeFile);
  if (errors.length) throw new Error(`unsafe relative file: ${relative}`);
  const file = await realpath(path.join(base, ...relative.split("/")));
  if (!within(base, file) || !(await stat(file)).isFile())
    throw new Error(
      `file escapes bundle or is not a regular file: ${relative}`,
    );
  return file;
}
export async function validateRegistry(
  registry,
  { directory = root, workspace = false, packaging = false } = {},
) {
  const errors = metadataErrors(registry),
    warnings = [];
  if (errors.length || (!workspace && !packaging)) return { errors, warnings };
  for (const entry of registry.plugins) {
    if (entry.source.kind !== "workspace") {
      warnings.push(
        `${entry.id}: archive metadata only; no bytes fetched or archive members inspected`,
      );
      continue;
    }
    try {
      const allowed = await realpath(
        path.resolve(
          directory,
          entry.type === "device"
            ? "../plugin-template/examples"
            : "../deckweave/plugins",
        ),
      );
      const bundle = await realpath(path.resolve(directory, entry.source.path));
      if (
        !within(allowed, bundle) ||
        path.basename(bundle) !==
          `${entry.id}.${entry.type === "device" ? "dwDevice" : "sdPlugin"}`
      )
        throw new Error("workspace path escapes allowed plugin directory");
      if (entry.type === "device") {
        const device = JSON.parse(
          await readFile(
            await fileInside(bundle, "deckweave.device.json"),
            "utf8",
          ),
        );
        const manifestErrors = schemaErrors(device, deviceManifestSchema);
        if (manifestErrors.length)
          throw new Error(
            "invalid device manifest: " + manifestErrors.join("; "),
          );
        if (
          device.kind !== "device" ||
          device.protocol !== entry.deviceProtocol ||
          device.id !== entry.id ||
          device.version !== entry.version ||
          device.name !== entry.name ||
          !["node", "native"].includes(device.runtime)
        )
          throw new Error("device manifest metadata/protocol mismatch");
        if (
          !Array.isArray(device.platforms) ||
          [...device.platforms].sort().join() !==
            [...entry.platforms].sort().join()
        )
          throw new Error("device manifest platforms mismatch");
        if (
          !Array.isArray(device.models) ||
          [...device.models].sort().join() !== [...entry.models].sort().join()
        )
          throw new Error("device manifest models mismatch");
        await fileInside(bundle, device.entry);
        for (const file of entry.requiredFiles ?? [])
          await fileInside(bundle, file.path);
        continue;
      }
      const manifest = JSON.parse(
        await readFile(await fileInside(bundle, "manifest.json"), "utf8"),
      );
      if (manifest.UUID && manifest.UUID !== entry.id)
        throw new Error("manifest UUID mismatch");
      if (manifest.Version !== entry.version)
        throw new Error("manifest Version mismatch");
      if (manifest.Name !== entry.name)
        throw new Error("manifest Name mismatch");
      await fileInside(bundle, manifest.CodePath);
      if (manifest.PropertyInspectorPath)
        await fileInside(bundle, manifest.PropertyInspectorPath);
      if (!Array.isArray(manifest.Actions) || !manifest.Actions.length)
        throw new Error("manifest has no actions");
      const controllers = new Set(),
        actions = new Set();
      for (const action of manifest.Actions) {
        if (
          typeof action.UUID !== "string" ||
          !action.UUID.startsWith(entry.id + ".") ||
          actions.has(action.UUID)
        )
          throw new Error(
            "action UUID is missing, duplicated or outside plugin namespace",
          );
        actions.add(action.UUID);
        for (const controller of action.Controllers ?? ["Keypad"])
          controllers.add(controller);
        if (action.PropertyInspectorPath)
          await fileInside(bundle, action.PropertyInspectorPath);
      }
      if (
        [...controllers].sort().join(",") !==
        [...entry.controllers].sort().join(",")
      )
        throw new Error("manifest Controllers mismatch");
      for (const file of entry.requiredFiles ?? []) {
        try {
          await fileInside(bundle, file.path);
        } catch (error) {
          if (packaging)
            throw new Error(
              `required distribution file ${file.path}: ${error.message}`,
            );
          warnings.push(
            `${entry.id}: ${file.path} is not bundled; source fallback may work, but archive packaging must fail`,
          );
        }
      }
    } catch (error) {
      errors.push(`${entry.id}: ${error.message}`);
    }
  }
  return { errors, warnings };
}
async function main() {
  const argv = process.argv.slice(2),
    command = argv.shift();
  let file = path.join(root, "registry.json"),
    workspace = false,
    packaging = false;
  if (command !== "validate")
    throw new Error(
      "Usage: node bin/registry.mjs validate [--workspace] [--packaging] [--file registry.json]",
    );
  while (argv.length) {
    const flag = argv.shift();
    if (flag === "--workspace") workspace = true;
    else if (flag === "--packaging") packaging = true;
    else if (flag === "--file" && argv.length)
      file = path.resolve(argv.shift());
    else throw new Error(`Unknown or incomplete option: ${flag}`);
  }
  const registry = JSON.parse(await readFile(file, "utf8"));
  const { errors, warnings } = await validateRegistry(registry, {
    directory: path.dirname(file),
    workspace,
    packaging,
  });
  warnings.forEach((w) => console.warn(`Warning: ${w}`));
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    `Valid registry: ${registry.plugins.length} plugins (${packaging ? "distribution files checked" : workspace ? "workspace checked" : "metadata only"})`,
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
