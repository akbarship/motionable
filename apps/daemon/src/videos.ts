// "Videolarim": every render and export across the projects, newest first, with their SRT when there is one.
import fs from 'node:fs';
import path from 'node:path';
import {HOME} from '@motionable/plan/store';
import {listProjects, projectDir} from './projects';

export type Video = {project: string; file: string; kind: 'export' | 'draft' | 'looks' | 'delivery'; version: number; bytes: number; at: string; srt?: string};

export const listVideos = (home = HOME): Video[] =>
  listProjects(home).flatMap(({id}) => {
    const out = path.join(projectDir(id, home), 'out');
    if (!fs.existsSync(out)) return [];
    return fs.readdirSync(out).filter((f) => f.endsWith('.mp4') && !f.includes('.part.')).flatMap((f): Video[] => {
      const exp = new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-v(\\d+)\\.mp4$`).exec(f);
      const rend = /^v(\d+)-(draft|looks|delivery)\.mp4$/.exec(f);
      if (!exp && !rend) return [];
      const st = fs.statSync(path.join(out, f));
      const srt = f.replace(/\.mp4$/, '.srt');
      return [{project: id, file: f, kind: exp ? 'export' : (rend![2] as Video['kind']), version: Number((exp ?? rend)![1]), bytes: st.size,
        at: st.mtime.toISOString(), ...(fs.existsSync(path.join(out, srt)) ? {srt} : {})}];
    });
  }).sort((a, b) => b.at.localeCompare(a.at));
