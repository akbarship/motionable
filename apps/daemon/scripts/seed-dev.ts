// A dev project without a paid call: any talking-head video, its transcript from a Scribe response you already have.
// Usage: npx tsx apps/daemon/scripts/seed-dev.ts <video> [scribe-response.json] [project-id]
//        (MOTIONABLE_HOME picks the data home; without a Scribe response the transcript step is left for the app)
import fs from 'node:fs';
import path from 'node:path';
import {analyzeFree, createProject, slug, transcribe} from '../src/analyze';
import {projectDir} from '../src/projects';

const [video, raw, given] = process.argv.slice(2);
if (!video || !fs.existsSync(video)) throw new Error('usage: seed-dev.ts <video> [scribe-response.json] [project-id]');
if (raw && !fs.existsSync(raw)) throw new Error(`missing ${raw}`);

const id = given ?? slug(video);
if (!fs.existsSync(projectDir(id))) await createProject([path.resolve(video)], {id, title: `${id} (dev)`});
const dir = projectDir(id);
const log = (step: string, status: string) => console.log(`${step}: ${status}`);
const report = await analyzeFree(dir, log);
const r = raw ? await transcribe(dir, log, path.resolve(raw)) : report;
console.log(JSON.stringify({id, dir, words: r.steps.transcribe?.words ?? null, warnings: r.warnings}));
