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

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Arbitrary<T> {
  generate(rng: Rng): T;
  shrink(value: T): T[];
}

export function int(min: number, max: number): Arbitrary<number> {
  return {
    generate: (rng) => min + Math.floor(rng() * (max - min + 1)),
    shrink: (value) => {
      const out: number[] = [];
      let cursor = min;
      while (cursor < value) {
        out.push(cursor);
        const step = Math.max(1, Math.floor((value - cursor) / 2));
        if (cursor + step >= value) {
          break;
        }
        cursor += step;
      }
      return out;
    },
  };
}

export function choice<T>(...values: T[]): Arbitrary<T> {
  return {
    generate: (rng) => values[Math.floor(rng() * values.length)]!,
    shrink: (value) => {
      const index = values.indexOf(value);
      return index > 0 ? values.slice(0, index) : [];
    },
  };
}

export function array<T>(element: Arbitrary<T>, maxLength: number): Arbitrary<T[]> {
  return {
    generate: (rng) => {
      const length = Math.floor(rng() * (maxLength + 1));
      const values: T[] = [];
      for (let index = 0; index < length; index += 1) {
        values.push(element.generate(rng));
      }
      return values;
    },
    shrink: (value) => {
      const out: T[][] = [];
      if (value.length === 0) {
        return out;
      }
      out.push([]);
      if (value.length > 2) {
        out.push(value.slice(0, value.length >> 1));
        out.push(value.slice(value.length >> 1));
      }
      for (let index = 0; index < value.length; index += 1) {
        out.push([...value.slice(0, index), ...value.slice(index + 1)]);
      }
      for (let index = 0; index < value.length; index += 1) {
        for (const shrunk of element.shrink(value[index]!)) {
          out.push([...value.slice(0, index), shrunk, ...value.slice(index + 1)]);
        }
      }
      return out;
    },
  };
}

export function map<T, U>(
  arbitrary: Arbitrary<T>,
  to: (value: T) => U,
  from: (value: U) => T,
): Arbitrary<U> {
  return {
    generate: (rng) => to(arbitrary.generate(rng)),
    shrink: (value) => arbitrary.shrink(from(value)).map(to),
  };
}

export type Property<T> = (value: T) => boolean;

export type Report<T> =
  { ok: true; runs: number } | { ok: false; seed: number; counterexample: T; shrinks: number };

export function minimize<T>(
  arbitrary: Arbitrary<T>,
  property: Property<T>,
  failing: T,
): [T, number] {
  let current = failing;
  let steps = 0;
  for (;;) {
    let advanced = false;
    for (const candidate of arbitrary.shrink(current)) {
      if (!property(candidate)) {
        current = candidate;
        steps += 1;
        advanced = true;
        break;
      }
    }
    if (!advanced) {
      return [current, steps];
    }
  }
}

export function check<T>(
  arbitrary: Arbitrary<T>,
  property: Property<T>,
  options: { runs?: number; seed: number },
): Report<T> {
  const runs = options.runs ?? 200;
  const base = options.seed >>> 0;
  for (let run = 0; run < runs; run += 1) {
    const seed = (base + run) >>> 0;
    const value = arbitrary.generate(mulberry32(seed));
    if (!property(value)) {
      const [counterexample, shrinks] = minimize(arbitrary, property, value);
      return { ok: false, seed, counterexample, shrinks };
    }
  }
  return { ok: true, runs };
}
