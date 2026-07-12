/**
 * @pwngh/economy-edge
 *
 * Copyright (c) Preston Neal
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProviderId } from '#src/canonical/index.ts';

const FIXTURES_ROOT = fileURLToPath(new URL('../fixtures', import.meta.url));

const TIERS = ['captured', 'expected'] as const;

type Tier = (typeof TIERS)[number];

export function fixture(provider: ProviderId, name: string): string {
  return readFileSync(fixturePath(provider, name), 'utf8');
}

export function isCaptured(provider: ProviderId, name: string): boolean {
  return existsSync(join(FIXTURES_ROOT, provider, 'captured', name));
}

export function fixtureNames(provider: ProviderId): string[] {
  const names = new Set<string>();
  for (const tier of TIERS) {
    for (const name of tierNames(provider, tier)) {
      names.add(name);
    }
  }
  return [...names].sort();
}

export function hasFixtures(provider: ProviderId): boolean {
  return fixtureNames(provider).length > 0;
}

function fixturePath(provider: ProviderId, name: string): string {
  const captured = join(FIXTURES_ROOT, provider, 'captured', name);
  return existsSync(captured) ? captured : join(FIXTURES_ROOT, provider, 'expected', name);
}

function tierNames(provider: ProviderId, tier: Tier): string[] {
  try {
    return readdirSync(join(FIXTURES_ROOT, provider, tier)).filter(
      (name) => !name.startsWith('.') && name !== 'README.md',
    );
  } catch {
    return [];
  }
}
