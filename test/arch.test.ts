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

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = fileURLToPath(new URL('../src', import.meta.url));

const RINGS = ['canonical', 'ports', 'codec', 'providers', 'testing'] as const;

type Ring = (typeof RINGS)[number] | 'root';

const ALLOWED: Record<Ring, readonly Ring[]> = {
  canonical: ['canonical'],
  ports: ['ports', 'canonical'],
  codec: ['codec', 'ports', 'canonical'],
  providers: ['providers', 'codec', 'ports', 'canonical'],
  testing: ['testing', 'providers', 'codec', 'ports', 'canonical'],
  root: ['codec', 'canonical'],
};

function ringOf(relativePath: string): Ring {
  const [head] = relativePath.split(sep);
  return (RINGS as readonly string[]).includes(head ?? '')
    ? (head as Ring)
    : 'root';
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')
      ? [path]
      : [];
  });
}

function importsOf(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
    (match) => match[1]!,
  );
}

describe('the one law', () => {
  const files = sourceFiles(SRC_ROOT);

  test('sees the source tree', () => {
    assert.ok(files.length > 0);
  });

  for (const file of files) {
    const fileRelative = relative(SRC_ROOT, file);
    const ring = ringOf(fileRelative);

    test(`${fileRelative} imports only inward`, () => {
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith('.')) {
          assert.equal(
            ring,
            'providers',
            `${fileRelative} imports the external module '${specifier}'; only providers/ may.`,
          );
          continue;
        }
        const target = relative(SRC_ROOT, resolve(dirname(file), specifier));
        assert.ok(
          !target.startsWith('..'),
          `${fileRelative} imports '${specifier}', which leaves src/.`,
        );
        const targetRing = ringOf(target);
        assert.ok(
          ALLOWED[ring].includes(targetRing),
          `${fileRelative} (${ring}) must not import '${specifier}' (${targetRing}).`,
        );
      }
    });
  }
});
