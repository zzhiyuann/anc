/**
 * Download images from Linear comments.
 * Linear upload URLs require Authorization header — agents can't access them directly.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const LINEAR_UPLOAD_RE = /https:\/\/uploads\.linear\.app\/[^\s)>"]+/g;

/** Download all Linear upload images in a comment body, replace URLs with local paths. */
export async function downloadCommentImages(body: string, workspacePath: string): Promise<string> {
  const matches = body.match(LINEAR_UPLOAD_RE);
  if (!matches || matches.length === 0) return body;

  const imgDir = join(workspacePath, '.comment-images');
  if (!existsSync(imgDir)) mkdirSync(imgDir, { recursive: true });

  let result = body;
  const apiKey = process.env.ANC_LINEAR_API_KEY;
  if (!apiKey) return body;  // can't download without auth

  for (const url of matches) {
    try {
      const localPath = await downloadImage(url, imgDir, apiKey);
      if (localPath) {
        result = result.replace(url, localPath);
      }
    } catch {
      // Non-blocking: if download fails, URL stays in text
    }
  }

  return result;
}

async function downloadImage(url: string, destDir: string, apiKey: string): Promise<string | null> {
  // Deterministic filename from URL hash (prevents duplicates)
  const hash = createHash('md5').update(url).digest('hex').substring(0, 12);
  const ext = url.match(/\.(png|jpg|jpeg|gif|webp|svg|pdf)/i)?.[1] ?? 'png';
  const filename = `img-${hash}.${ext}`;
  const destPath = join(destDir, filename);

  // Skip if already downloaded
  if (existsSync(destPath)) return destPath;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!res.ok) return null;

  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buffer);
  return destPath;
}
