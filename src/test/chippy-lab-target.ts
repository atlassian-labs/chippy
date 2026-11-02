export function resolveChippyLabTarget(value: string | undefined) {
  const port = value === undefined ? 6007 : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('CHIPPY_STORYBOOK_PORT must be an integer from 1 through 65535');
  }
  return { port: String(port), origin: `http://127.0.0.1:${port}` };
}

const target = resolveChippyLabTarget(process.env.CHIPPY_STORYBOOK_PORT);
export const STORYBOOK_PORT = target.port;
export const STORYBOOK_ORIGIN = target.origin;

export async function assertChippyLabIdentity(origin: string) {
  const response = await fetch(`${origin}/index.json`);
  if (!response.ok) throw new Error(`Cannot read Storybook index at ${origin}`);
  const index = await response.json() as { entries: Record<string, unknown> };
  if (!index.entries?.['avalanche-churnlab--default']) {
    throw new Error(`${origin} is serving another Storybook. Set CHIPPY_STORYBOOK_PORT to a free port for the Chippy lab.`);
  }
}
