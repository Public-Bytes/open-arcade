import { readFile, writeFile } from "node:fs/promises";
import { resolve, parse } from "node:path";
import { createServer } from "vite";
import puppeteer from "puppeteer-core";
const input = process.argv[2];
if (!input)
  throw Error("Usage: node scripts/repair-demo.mjs /path/to/demo.html");
const path = resolve(input),
  name = parse(path),
  html = await readFile(path, "utf8");
const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error(e.message));
  await page.goto(server.resolvedUrls.local[0]);
  const output = await page.evaluate(async (html) => {
    const { importHTML, portableHTML, exportProject } = await import(
      "/src/lib/export.ts"
    );
    const { renderSequence } = await import("/src/lib/render.ts");
    const p = await importHTML(
      new File([html], "demo.html", { type: "text/html" }),
    );
    const standalone = await portableHTML(p),
      archive = await exportProject(p);
    const movie = await renderSequence(p, "video", () => {});
    const encode = (blob) =>
      new Promise((r) => {
        const f = new FileReader();
        f.onload = () => r(f.result.slice(f.result.indexOf(";base64,") + 8));
        f.readAsDataURL(blob);
      });
    return {
      html: standalone,
      archive: await encode(archive),
      video: await encode(movie.blob),
      extension: movie.extension,
      geometry: p.steps.map((s) => ({
        type: s.type,
        width: s.width,
        height: s.height,
        crop: s.crop,
      })),
    };
  }, html);
  const prefix = resolve(name.dir, name.name + "-fixed");
  await writeFile(prefix + ".html", output.html);
  await writeFile(
    prefix + ".arcade.zip",
    Buffer.from(output.archive, "base64"),
  );
  await writeFile(
    prefix + "." + output.extension,
    Buffer.from(output.video, "base64"),
  );
  console.log(
    JSON.stringify(
      {
        files: [
          prefix + ".html",
          prefix + "." + output.extension,
          prefix + ".arcade.zip",
        ],
        geometry: output.geometry,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await server.close();
}
