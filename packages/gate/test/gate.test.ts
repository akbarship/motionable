// The gate's fast parts: forbidden code, test cases per kind, CSS read at build time.
import {describe, expect, it} from 'vitest';
import {cases, staticChecks} from '../src';
import {componentCss} from '@motionable/compose';
import type {ComponentManifest} from '@motionable/plan';

const ok = `MC.define('t@1', {css: '.t{font-family:Inter}', build(root, p, ctx, tl) { tl.fromTo(root, {opacity: 0}, {opacity: 1, duration: 0.2}, ctx.start); }});`;
const manifest = (kind: ComponentManifest['kind'], props: ComponentManifest['props']) =>
  ({name: 't', version: 1, kind, title: {en: 't'}, description: '', tags: [], props, needs: [], madeFrom: {kind: 'manual'},
    author: {kind: 'coder'}, owner: null, status: 'draft', compatibleWith: null, ae: {mode: 'layers'}}) as ComponentManifest;

describe('gate', () => {
  it('passes clean code and names each forbidden thing', () => {
    expect(staticChecks(ok, 't@1')).toEqual([]);
    const bad = ok.replace('ctx.start', 'Date.now() + Math.random()') + 'setTimeout(()=>{}, 1); gsap.to(x, {repeat: -1});';
    expect(staticChecks(bad, 't@1')).toEqual(expect.arrayContaining(['static: reads the clock', 'static: Math.random (use ctx.random(seed))',
      'static: timers or animation frames', 'static: endless repeat (repeat: -1)']));
    expect(staticChecks(ok, 'other@1')).toEqual(["static: must call MC.define('other@1', …)"]);
  });

  it('builds Uzbek, long-text and min/max cases', () => {
    const c = cases(manifest('overlay', {title: {type: 'text', default: 'x'}, size: {type: 'number', default: 80, min: 40, max: 140}}));
    expect(c.map((x) => x.name)).toEqual(['uzbek', 'long', 'size-min', 'size-max']);
    expect(String(c[0].props.title)).toContain('Gʻildirak');
    expect(c[3].props.size).toBe(140);
    const caps = cases(manifest('caption', {}));
    expect(caps.map((x) => x.name)).toEqual(['uzbek', 'long', 'face', 'many']);
    expect((caps[3].ctx.lines as unknown[]).length).toBeGreaterThan(8);
    expect(caps[2].ctx.underFace).toBe(true);
    expect((caps[0].ctx.lines as {words: {text: string}[]}[])[0].words[0].text).toBe('Oʻzbekiston');
  });

  it('reads a component\'s CSS without a browser', () => {
    expect(componentCss(ok, 't@1')).toBe('.t{font-family:Inter}');
  });
});
