import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
const supported = { darwin: ['arm64', 'x64'], win32: ['x64'], linux: ['x64', 'arm64'] };
if (!supported[process.platform]?.includes(process.arch) || !ffmpeg) {
  throw new Error(`Unsupported bundled FFmpeg platform: ${process.platform}/${process.arch}. Supported recording platforms: macOS arm64/x64 and Windows x64; Linux x64/arm64 is for CI only.`);
}
try {
  const version = execFileSync(ffmpeg, ['-version'], { encoding: 'utf8', timeout: 10000 });
  const encoders = execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 });
  const decoders = execFileSync(ffmpeg, ['-hide_banner', '-decoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 });
  if (!encoders.includes('libmp3lame') || !/\bopus\b/.test(decoders)) throw new Error('Required audio codecs are missing');
  console.log(`Bundled FFmpeg ready (${process.platform}/${process.arch}): ${version.split('\n')[0]}`);
} catch (cause) {
  throw new Error('Bundled FFmpeg is unavailable or lacks required codecs. Run npm ci with install scripts enabled and access to its binary downloads.', { cause });
}
