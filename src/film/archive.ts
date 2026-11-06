import { zipSync, strToU8 } from "fflate";
import { getAsset } from "../lib/db";
import { referencedAssets, type Project } from "../lib/model";
export async function filmArchive(p: Project) {
  const files: Record<string, Uint8Array> = {
      "project.json": strToU8(JSON.stringify(p)),
    },
    types: Record<string, string> = {};
  for (const id of referencedAssets(p)) {
    const asset = await getAsset(id);
    if (!asset) throw Error("A recording file is missing.");
    files["assets/" + id] = new Uint8Array(await asset.blob.arrayBuffer());
    types[id] = asset.blob.type;
  }
  files["media.json"] = strToU8(JSON.stringify(types));
  return new Blob([new Uint8Array(zipSync(files, { level: 0 }))], {
    type: "application/zip",
  });
}
