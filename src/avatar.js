import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

export function decodeAvatar(buffer) {
  if (buffer.length > 1024 * 1024) throw new Error('Avatar image is too large.');
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (buffer.length < 24 || buffer.readUInt32BE(16) > 512 || buffer.readUInt32BE(20) > 512) {
      throw new Error('Avatar dimensions are too large.');
    }
    return PNG.sync.read(buffer);
  }
  return jpeg.decode(buffer, { useTArray: true, maxResolutionInMP: 1, maxMemoryUsageInMB: 32 });
}

export async function fetchAvatar(value, signal) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'avatars.githubusercontent.com') return null;
    url.searchParams.set('s', '64');
    const response = await fetch(url, { signal });
    if (!response.ok || Number(response.headers.get('content-length')) > 1024 * 1024) return null;
    const image = decodeAvatar(Buffer.from(await response.arrayBuffer()));
    return { width: image.width, height: image.height, data: image.data };
  } catch { return null; }
}
