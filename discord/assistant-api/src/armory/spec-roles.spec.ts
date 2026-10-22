import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getGame } from '../game/games';
import { inferSpecs, type TalentBuild } from './spec-roles';

const forever = getGame('Forever');
const build = (active: boolean, ...trees: [string, number][]): TalentBuild => ({
  active,
  trees: trees.map(([name, points]) => ({ name, points })),
});

describe('inferSpecs (EXPERIMENTAL)', () => {
  it('takes the active build’s biggest tree as the main spec, its first role as the role', () => {
    const specs = inferSpecs(forever, 'Druid', [
      build(true, ['Balance', 0], ['Feral Combat', 31], ['Restoration', 20]),
    ]);
    // Feral can tank too, but Melee DPS comes first in the config.
    assert.deepEqual(specs.main, {
      spec: 'Feral',
      role: 'MELEE_DPS',
      talentTree: 'Feral Combat',
      points: 31,
      guessed: false,
    });
    assert.equal(specs.secondary, null);
    assert.deepEqual(specs.roles, ['MELEE_DPS']);
  });

  it('takes a second build (dual spec) as the secondary spec, its role after the main one', () => {
    const specs = inferSpecs(forever, 'Priest', [
      build(false, ['Holy', 31], ['Discipline', 20]),
      build(true, ['Shadow', 41]),
    ]);
    assert.equal(specs.main?.spec, 'Shadow');
    assert.equal(specs.secondary?.spec, 'Holy');
    assert.deepEqual(specs.roles, ['RANGED_DPS', 'HEALER']);
  });

  it('lists a role once when both specs have it', () => {
    const specs = inferSpecs(forever, 'Warrior', [
      build(true, ['Fury', 31]),
      build(false, ['Arms', 31]),
    ]);
    assert.deepEqual(specs.roles, ['MELEE_DPS']);
  });

  it('matches tree names written differently from the spec ("Beast Mastery" is BeastMastery)', () => {
    assert.equal(
      inferSpecs(forever, 'Hunter', [build(true, ['Beast Mastery', 31])]).main?.spec,
      'BeastMastery',
    );
  });

  it('assumes the class’s first spec when the talents say nothing', () => {
    for (const builds of [
      null,
      [],
      [build(true, ['Balance', 0])],
      [build(true, ['Unknown', 31])],
    ]) {
      const specs = inferSpecs(forever, 'Druid', builds);
      assert.deepEqual(
        [specs.main?.spec, specs.main?.guessed, specs.roles],
        ['Balance', true, ['RANGED_DPS']],
      );
    }
  });

  it('gives nothing for a class the game doesn’t have', () => {
    assert.deepEqual(inferSpecs(forever, 'Monk', [build(true, ['Brewmaster', 31])]), {
      main: null,
      secondary: null,
      roles: [],
    });
  });
});
