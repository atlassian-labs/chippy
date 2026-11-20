/**
 * How Jira names its own boundaries, as pack `labels` rules (see
 * ../pack/spec PackLabelRule). The Jira plugin compiles them into its context
 * provider, so page scripts read `ref.label` and the overlay paints
 * `nav-platform-top-nav` instead of `Suspense`.
 *
 * The rules are plain data: a Jira JSON pack, which replaces this plugin when
 * it uses the id `jira`, can carry the same list under `labels`.
 */

import type { PackLabelRule } from '../pack/spec';

const OWNER_MARK_PARTS = { separator: '___', keys: ['marker', 'type', 'name', 'package', 'variant'] };

export const JIRA_LABEL_RULES: PackLabelRule[] = [
  {
    for: 'suspense',
    value: 'props.interactionName',
    note: 'Jira passes the UFO interaction name to the Suspense element itself; it names the region that waits.',
  },
  {
    for: 'suspense',
    from: 'parents',
    match: { names: ['SuspenseWrapper', 'SuspensePlaceholder'] },
    value: 'props.name',
    note: 'A lazy section renders SuspensePlaceholder > SuspenseWrapper > Suspense; the `name` prop on either wrapper names the section.',
  },
  {
    for: 'suspense',
    from: 'parents',
    match: { pattern: '^OwnerMark___placeholder___' },
    within: 4,
    nameParts: OWNER_MARK_PARTS,
    value: 'parts.name',
    note: 'OwnerMark___placeholder___<name>___<package>___<variant> sits just above SuspenseWrapper when the wrapper props are gone.',
  },
  {
    for: 'suspense',
    from: 'parents',
    match: { names: ['Suspense'] },
    within: 1,
    value: 'props.interactionName',
    note: 'A Suspense rendered directly inside a named one waits for the same region.',
  },
  {
    for: 'error',
    value: ['props.id', 'props.location', 'props.name'],
    note: 'JSErrorBoundary and the ErrorBoundary class it renders take `id` (with `packageName` and `teamName`); navigation boundaries take `location`.',
  },
  {
    for: 'error',
    from: 'children',
    match: { pattern: '^OwnerMark___error-boundary___' },
    within: 2,
    nameParts: OWNER_MARK_PARTS,
    value: 'parts.name',
    note: 'OwnerMark___error-boundary___<id>___<package>___<variant> renders just inside the boundary class.',
  },
  {
    for: 'error',
    from: 'parents',
    match: { pattern: 'ErrorBoundary$' },
    within: 2,
    value: ['props.location', 'props.id'],
    note: 'A minified boundary class has no props of its own; the function wrapper around it (NavErrorBoundary > InnerErrorBoundary) holds `location`. The wrapper is not a boundary: it has no error lifecycle.',
  },
  {
    for: 'owner',
    match: { names: ['OwnerMark', 'OwnershipMark'], pattern: '^(OwnerMark|OwnershipMark)___' },
    nameParts: OWNER_MARK_PARTS,
    value: ['parts.name', 'props.name'],
    note: 'An ownership marker is named by the <name> segment of its display name, or by its `name` prop.',
  },
];
