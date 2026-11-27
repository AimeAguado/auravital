const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function imageExtension(buffer, contentType) {
  const type = String(contentType || '').split(';')[0].trim();
  if (!buffer.length || !IMAGE_TYPES[type]) return null;
  if (type === 'image/jpeg' && buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (type === 'image/png' && buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (type === 'image/webp' && buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (type === 'image/gif' && buffer.length > 6 && /^GIF8[79]a/.test(buffer.toString('ascii', 0, 6))) return 'gif';
  return null;
}

module.exports = { IMAGE_TYPES, imageExtension };
