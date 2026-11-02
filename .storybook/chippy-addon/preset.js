import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const managerEntries = (entry = []) => [...entry, join(here, 'manager.jsx')];
export const previewAnnotations = (entry = []) => [...entry, join(here, 'preview.js')];
