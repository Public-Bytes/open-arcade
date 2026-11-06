// Read container timestamps when MediaRecorder omits a WebM Duration element.
export async function webmDuration(blob: Blob): Promise<number> {
  const buffer = await blob.arrayBuffer(),
    view = new DataView(buffer),
    length = buffer.byteLength;
  let scale = 1_000_000,
    declared = 0,
    frameDuration = 1 / 30;
  const times: number[] = [];
  function vint(at: number, id = false) {
    if (at >= length) throw Error("Truncated WebM.");
    const first = view.getUint8(at);
    let size = 1;
    while (size <= 8 && !(first & (1 << (8 - size)))) size++;
    if (size > 8 || at + size > length) throw Error("Invalid WebM element.");
    let value = id ? first : first & ((1 << (8 - size)) - 1);
    let unknown = !id && value === (1 << (8 - size)) - 1;
    for (let i = 1; i < size; i++) {
      const byte = view.getUint8(at + i);
      value = value * 256 + byte;
      unknown = unknown && byte === 255;
    }
    return { size, value, unknown };
  }
  function uint(at: number, size: number) {
    let n = 0;
    for (let i = 0; i < size; i++) n = n * 256 + view.getUint8(at + i);
    return n;
  }
  function scan(from: number, to: number, cluster = 0, depth = 0) {
    if (depth > 12) throw Error("Invalid WebM nesting.");
    let time = cluster;
    for (let at = from; at < to; ) {
      const id = vint(at, true),
        size = vint(at + id.size),
        start = at + id.size + size.size,
        end = size.unknown ? to : start + size.value;
      if (end > to || end <= at) throw Error("Invalid WebM size.");
      const n = end - start;
      if (id.value === 0x2ad7b1) scale = uint(start, n);
      else if (id.value === 0x4489 && [4, 8].includes(n))
        declared = n === 4 ? view.getFloat32(start) : view.getFloat64(start);
      else if (id.value === 0x23e383 && n <= 8)
        frameDuration = uint(start, n) / 1e9;
      else if (id.value === 0xe7) time = uint(start, n);
      else if (id.value === 0xa3 || id.value === 0xa1) {
        const track = vint(start);
        if (n >= track.size + 3)
          times.push(time + view.getInt16(start + track.size));
      } else if (
        [0x18538067, 0x1549a966, 0x1f43b675, 0x1654ae6b, 0xae, 0xa0].includes(
          id.value,
        )
      )
        scan(start, end, id.value === 0x1f43b675 ? 0 : time, depth + 1);
      at = end;
    }
  }
  scan(0, length);
  if (declared > 0 && Number.isFinite(declared))
    return (declared * scale) / 1e9;
  if (!times.length)
    throw Error("No video timestamps were found in this WebM.");
  const last = [...new Set(times)].sort((a, b) => a - b).slice(-20);
  const deltas = last
    .slice(1)
    .map((t, i) => ((t - last[i]) * scale) / 1e9)
    .filter((t) => t > 0 && t < 1)
    .sort((a, b) => a - b);
  if (deltas.length) frameDuration = deltas[Math.floor(deltas.length / 2)];
  return (Math.max(...last) * scale) / 1e9 + frameDuration;
}
