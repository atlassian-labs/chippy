import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const requireFromTest = createRequire(import.meta.url);
const Module = requireFromTest('node:module');
const sessionModulePath = path.join(process.cwd(), '.agents/skills/chippy/browser-scripts/playwright-session.js');
const originalLoad = Module._load;

function clearSessionModuleCache() {
  try {
    delete requireFromTest.cache[requireFromTest.resolve(sessionModulePath)];
  } catch {
    // Module was not loaded in this test run.
  }
}

afterEach(() => {
  (Module as any)._load = originalLoad;
  clearSessionModuleCache();
});

describe('Chippy Playwright optional dependency', () => {
  it('loads the session helpers without playwright and refuses only Playwright launch', async () => {
    (Module as any)._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
      if (request === 'playwright') {
        const error = new Error("Cannot find module 'playwright'") as NodeJS.ErrnoException;
        error.code = 'MODULE_NOT_FOUND';
        throw error;
      }
      return originalLoad.call(this, request, parent, isMain);
    };

    clearSessionModuleCache();
    const session = requireFromTest(sessionModulePath);

    expect(session.getPlaywrightAvailability()).toMatchObject({
      ok: false,
      code: session.PLAYWRIGHT_UNAVAILABLE_CODE,
      error: expect.stringContaining('Playwright is not installed'),
    });
    await expect(session.launchSession()).rejects.toMatchObject({
      code: session.PLAYWRIGHT_UNAVAILABLE_CODE,
      message: expect.stringContaining('Playwright is not installed'),
    });
  });
});
