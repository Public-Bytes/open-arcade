import { test, expect } from "vitest";
import {
  newProject,
  newStep,
  uid,
  nextIndex,
  interpolate,
  safeUrl,
  validateProject,
  referencedAssets,
} from "../src/lib/model";
import {
  saveProject,
  getProject,
  putAsset,
  getAsset,
  duplicateProject,
  deleteProject,
  putChunk,
  recoverProject,
  chunksFor,
} from "../src/lib/db";
import { exportProject, importProject } from "../src/lib/export";
import { unzipSync, strFromU8 } from "fflate";
test("branch targets survive reordering and invalid targets fall through", () => {
  const p = newProject();
  p.steps = [newStep(), newStep(), newStep()];
  const id = p.steps[2].id;
  expect(nextIndex(p, 0, id)).toBe(2);
  p.steps.reverse();
  expect(nextIndex(p, 2, id)).toBe(0);
  expect(nextIndex(p, 0, "missing")).toBe(1);
  expect(nextIndex(p, 0, "end")).toBe(3);
});
test("variables preserve unknown keys and dangerous CTA protocols are rejected", () => {
  expect(interpolate("Hi {{ name }}, meet {{company}}", { name: "Alex" })).toBe(
    "Hi Alex, meet {{company}}",
  );
  expect(safeUrl("javascript:alert(1)")).toBe("");
  expect(safeUrl("https://example.com")).toBe("https://example.com/");
});
test("archive includes only referenced assets; round trip remaps assets and preserves branches", async () => {
  const p = newProject("Archive test");
  const s = newStep("image");
  s.assetId = uid();
  s.narrationId = uid();
  p.steps = [s, newStep()];
  s.hotspots = [
    { id: uid(), x: 40, y: 50, label: "Branch", target: p.steps[1].id },
  ];
  await saveProject(p);
  await putAsset({
    id: s.assetId,
    projectId: p.id,
    blob: new Blob(["redacted pixels"], { type: "image/png" }),
  });
  await putAsset({
    id: s.narrationId,
    projectId: p.id,
    blob: new Blob(["audio"], { type: "audio/webm" }),
  });
  const raw = uid();
  await putAsset({
    id: raw,
    projectId: p.id,
    blob: new Blob(["sensitive original"], { type: "image/png" }),
  });
  const zip = await exportProject(p);
  const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  expect(entries[`assets/${raw}`]).toBeUndefined();
  expect(strFromU8(entries[`assets/${s.assetId}`])).toBe("redacted pixels");
  const imported = await importProject(new File([zip], "test.zip"));
  expect(imported.id).not.toBe(p.id);
  expect(imported.steps[0].assetId).not.toBe(s.assetId);
  expect(imported.steps[0].hotspots[0].target).toBe(imported.steps[1].id);
  expect(await (await getAsset(imported.steps[0].assetId!))?.blob.text()).toBe(
    "redacted pixels",
  );
  expect(referencedAssets(imported)).toHaveLength(2);
});
test("duplicate owns its assets and deleting the original does not affect the copy", async () => {
  const p = newProject();
  const s = newStep("image");
  s.assetId = uid();
  p.steps = [s];
  await putAsset({
    id: s.assetId,
    projectId: p.id,
    blob: new Blob(["pixels"], { type: "image/png" }),
  });
  await saveProject(p);
  const copy = await duplicateProject(p);
  await deleteProject(p.id);
  expect(await getProject(p.id)).toBeUndefined();
  expect(await (await getAsset(copy.steps[0].assetId!))?.blob.text()).toBe(
    "pixels",
  );
});
test("interrupted recording recovers chunks in order and clears recovery data", async () => {
  const p = newProject();
  p.status = "recording";
  await saveProject(p);
  await putChunk(p.id, 1, new Blob(["second"], { type: "video/webm" }));
  await putChunk(p.id, 0, new Blob(["first"], { type: "video/webm" }));
  const recovered = await recoverProject(p);
  expect(recovered.status).toBe("draft");
  expect(await (await getAsset(`${p.id}-video`))?.blob.text()).toBe(
    "firstsecond",
  );
  expect(await chunksFor(p.id)).toHaveLength(0);
});
test("import rejects malformed project shapes and executable asset types", async () => {
  const p = newProject();
  p.steps = [newStep()];
  p.steps[0].zoom = Infinity;
  expect(() => validateProject(p)).toThrow("Invalid step");
  const q = newProject();
  q.steps = [newStep(), newStep()];
  q.steps[1].id = q.steps[0].id;
  expect(() => validateProject(q)).toThrow("Invalid step");
  await expect(
    importProject(new File(["garbage"], "bad.zip")),
  ).rejects.toThrow();
});
