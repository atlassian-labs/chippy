/**
 * Named constants for CommitStats tuple indices.
 *
 * CommitStats is a fixed 10-position tuple per commit. This module provides
 * human-readable names for each index to replace magic numbers in code.
 *
 * Tuple structure:
 * [0] collateral        — total updates caused by this source (collateral damage)
 * [1] sources           — number of distinct sources that fired in this commit
 * [2] restarts          — render count from ATL render-counter delta (or 0 if not available)
 * [3] performedWork     — components with PerformedWork flag set
 * [4] effects           — effect count
 * [5] memos             — memo count
 * [6] callbacks         — callback count
 * [7] contextUpdates    — context update count
 * [8] unmountedComponents — number of unmounted components
 * [9] unmountedSubtrees — number of unmounted subtrees
 *
 * This positional layout is shared by the detector, serializer, bridge, and
 * offline readers. Changing an index is a wire-format change even though the
 * tuple remains valid TypeScript, so keep the names and length together.
 */

export const CS_COLLATERAL = 0;
export const CS_SOURCES = 1;
export const CS_RESTARTS = 2;
export const CS_PERFORMED_WORK = 3;
export const CS_EFFECTS = 4;
export const CS_MEMOS = 5;
export const CS_CALLBACKS = 6;
export const CS_CONTEXT_UPDATES = 7;
export const CS_UNMOUNTED_COMPONENTS = 8;
export const CS_UNMOUNTED_SUBTREES = 9;

/**
 * Total length of the CommitStats tuple.
 * Used for validation and bounds checking.
 */
export const COMMIT_STATS_LENGTH = 10;

/**
 * Array of all commitStats indices for iteration/validation.
 */
export const ALL_COMMIT_STATS_INDICES = [
  CS_COLLATERAL,
  CS_SOURCES,
  CS_RESTARTS,
  CS_PERFORMED_WORK,
  CS_EFFECTS,
  CS_MEMOS,
  CS_CALLBACKS,
  CS_CONTEXT_UPDATES,
  CS_UNMOUNTED_COMPONENTS,
  CS_UNMOUNTED_SUBTREES,
] as const;
