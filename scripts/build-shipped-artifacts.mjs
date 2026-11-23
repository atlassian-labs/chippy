// Builds the shipped bundles from src/ and prints their paths, one per line.
// The Release workflow force-adds the printed paths to the commit for `main`.
import { buildShippedArtifacts, SHIPPED_ARTIFACTS } from './shipped-artifacts.mjs';

buildShippedArtifacts();
console.log(SHIPPED_ARTIFACTS.join('\n'));
