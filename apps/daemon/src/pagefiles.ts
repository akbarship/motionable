// Writing the preview page so an open player never reads half a file or a deleted clip: whole-file writes by rename,
// and old base clips kept until no page points at them.
import fs from 'node:fs';
import path from 'node:path';

/** Write `content` only if it differs; atomically (a temp file renamed over). Returns whether it changed. */
export const writeIfChanged = (file: string, content: string) => {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
  return true;
};

/** The base clip a page points at (assets/base-<key>.mp4), if any. */
export const baseOf = (html: string) => /assets\/(base-[0-9a-f]+\.mp4)/.exec(html)?.[1] ?? null;

/** Remove base clips other than the ones named (the current one, and the one the previous page used: a player that
 * hasn't reloaded yet still plays it). */
export const pruneBases = (assets: string, keep: (string | null)[]) => {
  const k = new Set(keep.filter(Boolean));
  const removed: string[] = [];
  for (const f of fs.existsSync(assets) ? fs.readdirSync(assets) : []) {
    if (f.startsWith('base-') && f.endsWith('.mp4') && !k.has(f)) {
      fs.rmSync(path.join(assets, f), {force: true});
      removed.push(f);
    }
  }
  return removed;
};
