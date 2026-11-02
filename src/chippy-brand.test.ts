import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const directory = '.agents/skills/chippy/extension';
const logo = readFileSync(`${directory}/logo.svg`, 'utf8').trim();

describe('Chippy brand assets', () => {
  it('keeps the page and Storybook marks aligned with the canonical SVG', () => {
    const mark = logo.replace('<svg ', '<svg data-chippy-logo aria-hidden="true" width="24" height="24" ');
    const layout = readFileSync(`${directory}/layout-lab.js`, 'utf8');
    const manager = readFileSync('.storybook/chippy-addon/brand.jsx', 'utf8');
    expect(layout).toContain(`const CHIPPY_LOGO = ${JSON.stringify(mark)};`);
    expect(manager).toContain(JSON.stringify(mark));
    expect(layout).not.toContain('🪚');
    const popup = new JSDOM(readFileSync(`${directory}/popup.html`, 'utf8'));
    expect(popup.window.document.querySelector('header img')?.getAttribute('src')).toBe('logo.svg');
    popup.window.close();
  });

  it('ships every icon declared for the extension and toolbar at its actual dimensions', () => {
    const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, 'utf8'));
    expect(manifest.icons).toEqual(manifest.action.default_icon);
    expect(Object.keys(manifest.icons)).toEqual(['16', '32', '48', '128']);
    for (const [size, file] of Object.entries(manifest.icons)) {
      const png = readFileSync(`${directory}/${file}`);
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(png.readUInt32BE(16)).toBe(Number(size));
      expect(png.readUInt32BE(20)).toBe(Number(size));
    }
  });
});
