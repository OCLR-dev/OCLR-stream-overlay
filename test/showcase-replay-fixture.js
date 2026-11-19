// A synthetic stable .osr container with an LZMA-compressed replay payload.
export function replayFixture() {
  const string = value => Buffer.concat([Buffer.of(0x0b, Buffer.byteLength(value)), Buffer.from(value)]);
  const header = Buffer.alloc(5);
  header.writeUInt32LE(20250101, 1);
  const score = Buffer.alloc(23);
  score.writeUInt32LE(8, 19);
  const data = Buffer.from('XQAAgAD//////////wAWjEKSame+b2TNKAOd9nOXUy6gpnQAUob6ca9YWkpD///biwAA', 'base64');
  const frameLength = Buffer.alloc(12);
  frameLength.writeInt32LE(data.length, 8);
  return Buffer.concat([header, string('a'.repeat(32)), string('Test player'), string('b'.repeat(32)), score,
    Buffer.of(0), frameLength, data, Buffer.alloc(8)]);
}
