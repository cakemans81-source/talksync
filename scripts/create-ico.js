/**
 * create-ico.js — PNG → ICO 변환 (Node.js 내장 모듈만 사용)
 * 16x16, 32x32, 48x48, 256x256 멀티사이즈 ICO 생성
 * rcedit-x64.exe 호환 형식
 */
const fs   = require('fs');
const path = require('path');
const { createCanvas, loadImage } = (() => {
  try { return require('canvas'); } catch { return null; }
})() || {};

const srcPng = process.argv[2];
const dstIco = process.argv[3];

if (!srcPng || !dstIco) {
  console.error('Usage: node create-ico.js <src.png> <dst.ico>');
  process.exit(1);
}

// canvas 모듈 없이 PNG 바이트를 그대로 ICO에 넣는 방법
// ICO 스펙: 256x256 PNG 그대로 넣기 허용 (Vista+)
// 16/32/48 사이즈는 PNG 리사이즈가 필요하므로 canvas 없으면 256만 넣음
async function main() {
  const pngBuf = fs.readFileSync(srcPng);

  if (createCanvas) {
    // canvas 모듈이 있으면 멀티사이즈 생성
    const sizes = [16, 32, 48, 256];
    const img = await loadImage(srcPng);
    const pngBuffers = sizes.map(size => {
      const canvas = createCanvas(size, size);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      return canvas.toBuffer('image/png');
    });
    writeIco(dstIco, pngBuffers, sizes);
    console.log(`✓ ICO 생성 완료 (멀티사이즈: ${sizes.join(',')}px) → ${dstIco}`);
  } else {
    // canvas 없으면 256x256 단일 PNG ICO (rcedit 호환)
    writeIco(dstIco, [pngBuf], [256]);
    console.log(`✓ ICO 생성 완료 (256px 단일) → ${dstIco}`);
  }
}

/**
 * ICO 포맷 작성
 * @param {string} outPath
 * @param {Buffer[]} pngBuffers
 * @param {number[]} sizes
 */
function writeIco(outPath, pngBuffers, sizes) {
  const count = pngBuffers.length;
  // ICO 헤더: 6바이트
  // ICONDIRENTRY: 16바이트 × count
  const headerSize = 6 + 16 * count;

  const header = Buffer.alloc(headerSize);
  // Reserved=0, Type=1(ICO), Count
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  let offset = headerSize;
  const entries = [];

  for (let i = 0; i < count; i++) {
    const size = sizes[i];
    const buf  = pngBuffers[i];
    const entryOffset = 6 + 16 * i;

    // Width / Height: 0 = 256
    header.writeUInt8(size === 256 ? 0 : size, entryOffset + 0);
    header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    header.writeUInt8(0,   entryOffset + 2);  // ColorCount
    header.writeUInt8(0,   entryOffset + 3);  // Reserved
    header.writeUInt16LE(1, entryOffset + 4); // Planes
    header.writeUInt16LE(32, entryOffset + 6); // BitCount
    header.writeUInt32LE(buf.length, entryOffset + 8);  // SizeInBytes
    header.writeUInt32LE(offset,     entryOffset + 12); // FileOffset

    offset += buf.length;
    entries.push(buf);
  }

  fs.writeFileSync(outPath, Buffer.concat([header, ...entries]));
}

main().catch(e => { console.error(e); process.exit(1); });
