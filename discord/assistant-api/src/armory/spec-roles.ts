import type { Role } from '@prisma/client';
import { ROLE_LABELS } from '../characters/role-labels';
import type { GameConfig } from '../game/game-config';

/**
 * EXPERIMENTAL: a character's specs and roles, worked out from the talent points the armory lists.
 *
 * The armory gives talent trees ("Feral Combat", 31 points), not specs or roles. A build's spec is
 * its tree with the most points, matched to one of the class's specs in the game's config by name
 * ("Feral Combat" is Feral); its role is the first the config lists for that spec (Feral: Melee
 * DPS, though it can tank). The active build is the main spec, a second build (dual spec) the
 * secondary one. When the talents say nothing usable, the class's first spec is assumed (marked
 * `guessed`). Later a talent that only one spec takes could tell, e.g. a tanking Feral; Forever may
 * change how this works.
 */

/** A talent tree and the points spent in it. */
export interface TalentTree {
  name: string;
  points: number;
}

/** One set of talents; a character with dual spec has two, one of them active. */
export interface TalentBuild {
  active: boolean;
  trees: TalentTree[];
}

export interface SpecGuess {
  /** The spec, as the game's config names it (e.g. `Feral`). */
  spec: string;
  /** Its first role in the config. */
  role: Role;
  /** The talent tree it came from and its points; null when it was assumed. */
  talentTree: string | null;
  points: number | null;
  /** No talents told: the class's first spec was assumed. */
  guessed: boolean;
}

export interface SpecInference {
  main: SpecGuess | null;
  secondary: SpecGuess | null;
  /** The roles to fill in: the main spec's, then the secondary's if it differs. */
  roles: Role[];
}

const ROLE_OF_LABEL = new Map(
  (Object.entries(ROLE_LABELS) as [Role, string][]).map(([role, label]) => [label, role]),
);

const simplify = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');

/** The tree with the most points (none when no points were spent). */
function topTree(build: TalentBuild | undefined): TalentTree | null {
  const trees = (build?.trees ?? []).filter((tree) => tree.points > 0);
  return trees.reduce<TalentTree | null>(
    (best, tree) => (best === null || tree.points > best.points ? tree : best),
    null,
  );
}

export function inferSpecs(
  game: GameConfig | undefined,
  className: string,
  builds: TalentBuild[] | null,
): SpecInference {
  const specs = Object.entries(game?.classes[className]?.specializations ?? {});
  const roleOf = (spec: string): Role | null => {
    const label = specs.find(([name]) => name === spec)?.[1].roles[0];
    return (label && ROLE_OF_LABEL.get(label)) ?? null;
  };
  // A tree is the spec whose name it starts with, or that starts with it ("Feral Combat" / Feral,
  // "Beast Mastery" / BeastMastery); the first such spec when several would do.
  const specOfTree = (tree: string): string | null => {
    const simple = simplify(tree);
    return (
      specs
        .map(([name]) => name)
        .find((name) => {
          const spec = simplify(name);
          return simple.startsWith(spec) || spec.startsWith(simple);
        }) ?? null
    );
  };
  const fromBuild = (build: TalentBuild | undefined): SpecGuess | null => {
    const tree = topTree(build);
    const spec = tree && specOfTree(tree.name);
    const role = spec && roleOf(spec);
    return spec && role
      ? { spec, role, talentTree: tree.name, points: tree.points, guessed: false }
      : null;
  };

  const active = builds?.find((build) => build.active) ?? builds?.[0];
  const other = builds?.find((build) => build !== active);
  let main = fromBuild(active);
  if (!main && specs.length > 0) {
    // Nothing to go by: whichever spec comes first.
    const [first] = specs[0];
    const role = roleOf(first);
    main = role ? { spec: first, role, talentTree: null, points: null, guessed: true } : null;
  }
  const secondary = fromBuild(other);
  const roles = [main?.role, secondary?.role].filter(
    (role, i, all): role is Role => role !== undefined && all.indexOf(role) === i,
  );
  return { main, secondary, roles };
}
