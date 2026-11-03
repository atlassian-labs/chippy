/**
 * Jira context provider: recognizes Jira's OwnerMark/OwnershipMark ownership
 * markers and JSErrorBoundary props, and layers them onto the generic marker
 * context as an `owner` boundary kind and error-boundary enrichment.
 *
 * Registered by the bundle's composition root; the core marker context works
 * without it.
 */

import { type Fiber, getDisplayName } from '../../layout-lab/fiber-walk';
import {
  type ContextContribution,
  type ContextField,
  type ContextProvider,
  type MarkerContext,
  describeContext,
} from '../../layout-lab/marker-context';

export type JiraOwnership = {
  markerName: string;
  type: string | null;
  name: string | null;
  packageName: string | null;
  teamName: string | null;
  variant: string | null;
  source: 'display-name' | 'props';
};

export type JiraErrorBoundary = {
  componentName: string;
  id: string | null;
  packageName: string | null;
  fallback: string | null;
  teamName: string | null;
};

const OWNER_MARK_NAMES = new Set(['OwnerMark', 'OwnershipMark']);

function readScalar(props: Record<string, unknown> | null | undefined, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = props?.[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return null;
}

function displayNameOf(fiber: Fiber): string | null {
  return getDisplayName(fiber.type) || getDisplayName(fiber.elementType) || null;
}

export function parseOwnerMarkDisplayName(displayName: string | null | undefined): JiraOwnership | null {
  if (!displayName) return null;
  const parts = displayName.split('___');
  if (!OWNER_MARK_NAMES.has(parts[0])) return null;
  if (parts.length === 1) return null;
  return {
    markerName: displayName,
    type: parts[1] || null,
    name: parts[2] || null,
    packageName: parts[3] || null,
    teamName: null,
    variant: parts[4] || null,
    source: 'display-name',
  };
}

export function describeOwnership(fiber: Fiber): JiraOwnership | null {
  const displayName = displayNameOf(fiber);
  const encoded = parseOwnerMarkDisplayName(displayName);
  if (encoded) {
    return {
      ...encoded,
      packageName: encoded.packageName || readScalar(fiber.memoizedProps, 'packageName', 'package'),
      teamName: readScalar(fiber.memoizedProps, 'teamName', 'team'),
    };
  }
  if (!displayName || !OWNER_MARK_NAMES.has(displayName)) return null;
  return {
    markerName: displayName,
    type: readScalar(fiber.memoizedProps, 'type', 'boundaryType'),
    name: readScalar(fiber.memoizedProps, 'name', 'id'),
    packageName: readScalar(fiber.memoizedProps, 'packageName', 'package'),
    teamName: readScalar(fiber.memoizedProps, 'teamName', 'team'),
    variant: readScalar(fiber.memoizedProps, 'variant'),
    source: 'props',
  };
}

/** Jira enrichment for an error boundary, read from JSErrorBoundary props. */
function jiraErrorBoundary(fiber: Fiber): JiraErrorBoundary | null {
  const componentName = displayNameOf(fiber);
  if (componentName !== 'JSErrorBoundary') return null;
  return {
    componentName,
    id: readScalar(fiber.memoizedProps, 'id'),
    packageName: readScalar(fiber.memoizedProps, 'packageName'),
    fallback: readScalar(fiber.memoizedProps, 'fallback'),
    teamName: readScalar(fiber.memoizedProps, 'teamName'),
  };
}

function field(label: string, value: string | null | undefined): ContextField[] {
  return value ? [{ label, value }] : [];
}

/**
 * Scan the probed ancestry for OwnerMark ownership, the nearest JSErrorBoundary,
 * and Jira's ErrorComponent fallback marker.
 */
export function describeJiraContribution(fibers: Fiber[]): ContextContribution | null {
  let ownership: JiraOwnership | null = null;
  let ownerDistance = -1;
  let errorBoundary: JiraErrorBoundary | null = null;
  let errorComponent = false;

  for (let distance = 0; distance < fibers.length; distance += 1) {
    const entry = fibers[distance];
    if (!ownership) {
      const found = describeOwnership(entry);
      if (found) {
        ownership = found;
        ownerDistance = distance;
      }
    }
    if (!errorBoundary) errorBoundary = jiraErrorBoundary(entry);
    const displayName = displayNameOf(entry);
    if (displayName === 'ErrorComponent' || displayName?.endsWith('ErrorComponent')) errorComponent = true;
    if (ownership && errorBoundary && errorComponent) break;
  }

  if (!ownership && !errorBoundary && !errorComponent) return null;
  return {
    boundaries: { owner: ownership ? { ...ownership, distance: ownerDistance } : null },
    errorEnrichment: errorBoundary,
    titles: {
      ...(ownership ? { owner: ownership.name || ownership.markerName } : {}),
      ...(errorBoundary ? {} : errorComponent ? { error: 'ErrorComponent' } : {}),
    },
    // Keep only the fields that matter operationally: team and id (the
    // Sentry key). package/fallback stay on the boundary payload.
    fields: errorBoundary ? { error: [...field('team', errorBoundary.teamName), ...field('id', errorBoundary.id)] } : {},
    showError: errorComponent,
    // Legacy Jira-shaped fields, preserved for existing consumers.
    extra: { ownership, errorComponent, errorBoundary },
  };
}

export const jiraContextProvider: ContextProvider = {
  id: 'jira',
  kinds: [{ kind: 'owner', label: 'owner', accent: '#0c66e4' }],
  describe: describeJiraContribution,
  matchBoundary: (fiber) => (describeOwnership(fiber) ? 'owner' : null),
};

/** The marker context with the Jira fields always present. */
export function describeJiraContext(fiber: Fiber | null | undefined): MarkerContext | null {
  const context = describeContext(fiber);
  if (!context) return null;
  return {
    ownership: null,
    errorComponent: false,
    errorBoundary: null,
    ...context,
    boundaries: { owner: null, ...context.boundaries },
  };
}
