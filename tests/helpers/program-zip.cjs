const fs = require('node:fs/promises');
const { crc32 } = require('node:zlib');
async function writeZip(file, entries) {
  const local = [],
    central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      data = Buffer.from(entry.data || ''),
      checksum = entry.crc ?? crc32(data),
      header = Buffer.alloc(30),
      descriptor = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    descriptor.writeUInt32LE(0x02014b50);
    descriptor.writeUInt16LE(0x314, 4);
    descriptor.writeUInt16LE(20, 6);
    descriptor.writeUInt16LE(0x800, 8);
    descriptor.writeUInt32LE(checksum, 16);
    descriptor.writeUInt32LE(data.length, 20);
    descriptor.writeUInt32LE(data.length, 24);
    descriptor.writeUInt16LE(name.length, 28);
    descriptor.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    descriptor.writeUInt32LE(offset, 42);
    local.push(header, name, data);
    central.push(descriptor, name);
    offset += header.length + name.length + data.length;
  }
  const listing = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(listing.length, 12);
  end.writeUInt32LE(offset, 16);
  await fs.writeFile(file, Buffer.concat([...local, listing, end]));
}
module.exports = { writeZip };
