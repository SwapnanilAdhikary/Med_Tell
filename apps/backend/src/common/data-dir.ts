import * as path from 'node:path';

/** Writable root — `/tmp` on Vercel serverless, repo root locally. */
export function dataRoot(): string {
  return process.env.VERCEL ? '/tmp' : process.cwd();
}

export function dataPath(...segments: string[]): string {
  return path.join(dataRoot(), ...segments);
}
