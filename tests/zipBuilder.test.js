const { test } = require("node:test");
const assert = require("node:assert");
const zipBuilder = require("../src/background/zipBuilder.js");

test("crc32 reference value", () => {
  const bytes = new TextEncoder().encode("123456789");
  assert.strictEqual(zipBuilder.crc32(bytes), 0xcbf43926);
});

test("buildZip produces a structurally valid archive", () => {
  const out = zipBuilder.buildZip([
    { name: "a.txt", content: "hello" },
    { name: "dir/b.json", content: '{"x":1}' },
  ]);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  // Local file header signature at start
  assert.strictEqual(dv.getUint32(0, true), 0x04034b50);
  // EOCD signature at the end
  assert.strictEqual(dv.getUint32(out.length - 22, true), 0x06054b50);
  // entry count
  assert.strictEqual(dv.getUint16(out.length - 22 + 10, true), 2);
  // file content stored verbatim
  const text = Buffer.from(out).toString("latin1");
  assert.ok(text.includes("hello"));
  assert.ok(text.includes('{"x":1}'));
});

test("zip opens with system unzip semantics (central directory offsets)", () => {
  const out = zipBuilder.buildZip([{ name: "x.txt", content: "abc" }]);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const eocdOff = out.length - 22;
  const cdSize = dv.getUint32(eocdOff + 12, true);
  const cdOffset = dv.getUint32(eocdOff + 16, true);
  assert.strictEqual(cdOffset + cdSize + 22, out.length);
  // central dir signature where EOCD says it is
  assert.strictEqual(dv.getUint32(cdOffset, true), 0x02014b50);
});
