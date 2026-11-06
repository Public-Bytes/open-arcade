import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
async function walk(dir, prefix = "") {
  const files = {};
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${e.name}`,
      name = prefix + e.name;
    if (e.isDirectory()) Object.assign(files, await walk(path, name + "/"));
    else files[name] = new Uint8Array(await readFile(path));
  }
  return files;
}
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const seen = new Set(),
  notices = [];
async function license(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const dir = `node_modules/${name}`,
    p = JSON.parse(await readFile(`${dir}/package.json`, "utf8"));
  const licenses = (await readdir(dir)).filter((f) =>
    /^licen[cs]e([.-]|$)/i.test(f),
  );
  notices.push(
    `\n${"=".repeat(70)}\n${name} ${p.version}\nLicense: ${p.license}\n`,
  );
  for (const f of licenses) notices.push(await readFile(`${dir}/${f}`, "utf8"));
  for (const dependency of Object.keys(p.dependencies || {}))
    await license(dependency);
}
for (const name of Object.keys(pkg.dependencies)) await license(name);
await writeFile("dist/THIRD_PARTY_NOTICES.txt", notices.join("\n"));
for (const file of ["LICENSE", "PRIVACY.md", "RECORDLY-LICENSE.md"])
  await writeFile(`dist/${file}`, await readFile(file));
await mkdir("release", { recursive: true });
const extensionName = `open-arcade-${pkg.version}.zip`,
  sourceName = `open-arcade-${pkg.version}-source.zip`;
await writeFile(`release/${extensionName}`, zipSync(await walk("dist")));
const source = {};
for (const dir of ["src", "public", "scripts", "tests", ".github"])
  Object.assign(source, await walk(dir, dir + "/"));
for (const file of [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
  "playwright.config.ts",
  "index.html",
  "popup.html",
  "offscreen.html",
  "permissions.html",
  "hud.html",
  ".gitignore",
  "README.md",
  "PRIVACY.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "RECORDLY-LICENSE.md",
])
  source[file] = new Uint8Array(await readFile(file));
await writeFile(`release/${sourceName}`, zipSync(source));
const hashes = [];
for (const file of [extensionName, sourceName])
  hashes.push(
    `${createHash("sha256")
      .update(await readFile(`release/${file}`))
      .digest("hex")}  ${file}`,
  );
await writeFile("release/SHA256SUMS", hashes.join("\n") + "\n");
console.log(
  `Packaged extension and complete source in release/ (${pkg.version})`,
);
