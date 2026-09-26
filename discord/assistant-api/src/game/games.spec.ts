import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { defineGame, gameConfigProblems } from './game-config';
import {
  classesOf,
  gameVersions,
  games,
  getGame,
  isGameVersion,
  isWowClass,
  lastNameRequiredMessage,
  loadGames,
  requiresLastName,
  rolesOfClass,
  serversOf,
} from './games';

/** A minimal valid config, as source text, for a directory made in a test. */
const configSource = (over: Record<string, unknown> = {}): string => {
  const config = {
    gameVersion: 'Test',
    rules: { lastNameRequired: false },
    allowedServers: { EU: ['PVE'] },
    classes: { Mage: { specializations: {} } },
    factions: { Alliance: { races: { Human: { classes: ['Mage'] } } } },
    ...over,
  };
  return `module.exports = { default: ${JSON.stringify(config)} };`;
};

const withDirectories = (files: Record<string, string>, check: (root: string) => void): void => {
  const root = mkdtempSync(join(tmpdir(), 'games-'));
  try {
    for (const [path, source] of Object.entries(files)) {
      mkdirSync(join(root, path.split('/')[0]), { recursive: true });
      writeFileSync(join(root, path), source);
    }
    check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe('the game versions found on disk', () => {
  it('has Forever, loaded from game/forever/config.ts', () => {
    assert.deepEqual(gameVersions(), ['Forever']);
    assert.equal(games().length, 1);
    assert.equal(getGame('Forever')?.gameVersion, 'Forever');
    assert.equal(isGameVersion('Forever'), true);
    assert.equal(isGameVersion('Retail'), false);
    assert.equal(isGameVersion(undefined), false);
  });

  it('is valid: the real Forever config passes the same checks a loaded config gets', () => {
    assert.deepEqual(gameConfigProblems(getGame('Forever')), []);
  });

  it('loads every directory that has a config, in name order, and ignores the ones without', () => {
    withDirectories(
      {
        'beta/config.js': configSource({ gameVersion: 'Beta' }),
        'alpha/config.js': configSource({ gameVersion: 'Alpha' }),
        'shared/helper.js': 'module.exports = {};',
      },
      (root) =>
        assert.deepEqual(
          loadGames(root).map((g) => g.gameVersion),
          ['Alpha', 'Beta'],
        ),
    );
  });

  it('refuses a config that is not valid, naming the directory and what is wrong', () => {
    withDirectories({ 'broken/config.js': configSource({ rules: {}, classes: {} }) }, (root) =>
      assert.throws(
        () => loadGames(root),
        /"broken" is not valid.*rules\.lastNameRequired.*classes needs at least one class/s,
      ),
    );
  });

  it('refuses two directories for the same version, and no versions at all', () => {
    withDirectories({ 'one/config.js': configSource(), 'two/config.js': configSource() }, (root) =>
      assert.throws(() => loadGames(root), /Two game configs are for "Test"/),
    );
    withDirectories({ 'empty/readme.txt': 'nothing' }, (root) =>
      assert.throws(() => loadGames(root), /No game config was found/),
    );
  });
});

describe('checking a config', () => {
  const valid = () =>
    JSON.parse(configSource().replace(/^module\.exports = \{ default: (.*) \};$/, '$1'));

  it('accepts a good one', () => assert.deepEqual(gameConfigProblems(valid()), []));

  it('only lets a race list classes that the game has', () => {
    const config = valid();
    config.factions.Alliance.races.Human.classes = ['Mage', 'Bard'];
    assert.deepEqual(gameConfigProblems(config), [
      'Alliance Human lists the class "Bard", which is not in classes',
    ]);
  });

  it('refuses regions that do not exist, empty server lists and empty races', () => {
    const config = valid();
    config.allowedServers = { MARS: ['PVE'], EU: [] };
    config.factions.Alliance.races.Human.classes = [];
    const problems = gameConfigProblems(config).join('\n');
    assert.match(problems, /"MARS", which is not a region/);
    assert.match(problems, /allowedServers\.EU must be a list of server names/);
    assert.match(problems, /Alliance Human needs at least one class/);
  });

  it('checks specializations: their roles must be roles', () => {
    const config = valid();
    config.classes.Mage.specializations = { Fire: { roles: ['Wizard'] } };
    assert.match(gameConfigProblems(config).join(), /Fire\.roles must list Tank, Healer/);
    config.classes.Mage.specializations = { Fire: { roles: ['Ranged DPS'] } };
    assert.deepEqual(gameConfigProblems(config), []);
    delete config.classes.Mage.specializations;
    assert.match(gameConfigProblems(config).join(), /specializations is missing/);
  });

  it('refuses things that are not a config at all', () => {
    assert.deepEqual(gameConfigProblems(undefined), ['it does not export a config object']);
    assert.ok(gameConfigProblems({}).length > 0);
  });

  it('has classes checked when it is written (a class a race lists must exist)', () => {
    defineGame({
      gameVersion: 'T',
      rules: { lastNameRequired: false },
      allowedServers: { EU: ['PVE'] },
      classes: { Mage: { specializations: {} } },
      factions: { Alliance: { races: { Human: { classes: ['Mage'] } } } },
    });
    defineGame({
      gameVersion: 'T',
      rules: { lastNameRequired: false },
      allowedServers: { EU: ['PVE'] },
      classes: { Mage: { specializations: {} } },
      // @ts-expect-error "Bard" is not one of the game's classes
      factions: { Alliance: { races: { Human: { classes: ['Mage', 'Bard'] } } } },
    });
  });
});

describe('asking about a version', () => {
  it('lists the classes of a version, and knows a class of any version', () => {
    assert.deepEqual(classesOf('Forever').sort(), [
      'Druid',
      'Hunter',
      'Mage',
      'Paladin',
      'Priest',
      'Rogue',
      'Shaman',
      'Warlock',
      'Warrior',
    ]);
    assert.deepEqual(classesOf('Retail'), []);
    assert.equal(isWowClass('Warrior'), true);
    assert.equal(isWowClass('Bard'), false);
  });

  it('gives the roles of a class: those of its specializations, in the usual order', () => {
    assert.deepEqual(rolesOfClass('Forever', 'Druid'), [
      'Tank',
      'Healer',
      'Melee DPS',
      'Ranged DPS',
    ]);
    assert.deepEqual(rolesOfClass('Forever', 'Mage'), ['Ranged DPS']);
    assert.deepEqual(rolesOfClass('Forever', 'Paladin'), ['Tank', 'Healer', 'Melee DPS']);
    // Nothing is known about an unknown class or version: every role is allowed.
    assert.deepEqual(rolesOfClass('Forever', 'Bard'), []);
    assert.deepEqual(rolesOfClass('Retail', 'Mage'), []);
  });

  it('lists the servers of a version per region, none when it is not there', () => {
    assert.deepEqual(serversOf('Forever', 'EU'), ['RP', 'PVP', 'PVE', 'Hardcore']);
    assert.deepEqual(serversOf('Forever', 'US'), ['RP', 'PVP', 'PVE', 'Hardcore']);
    assert.deepEqual(serversOf('Retail', 'EU'), []);
  });

  it('takes the last-name rule from the version’s rules', () => {
    assert.equal(requiresLastName('Forever'), true);
    assert.equal(requiresLastName('Something else'), false);
    assert.match(lastNameRequiredMessage('Forever'), /Forever.*last name.*Name-Lastname/);
  });

  it('only lists, in the Forever config, races with classes the version has', () => {
    const forever = getGame('Forever');
    assert.ok(forever);
    for (const [faction, { races }] of Object.entries(forever.factions)) {
      for (const [race, { classes }] of Object.entries(races)) {
        for (const name of classes) {
          assert.ok(name in forever.classes, `${faction} ${race}: ${name}`);
        }
      }
    }
  });
});
