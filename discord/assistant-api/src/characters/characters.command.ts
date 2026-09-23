import { Injectable } from '@nestjs/common';
import { Command } from '../bot/decorators/command.decorator';
import {
  getBooleanOption,
  getInvokerId,
  getStringOption,
  type DiscordInteraction,
} from '../bot/discord-interaction.types';
import { isWowClass } from '../game/wow-class';
import { formatCharacterName, parseCharacterName } from './character-name';
import { CharactersService, type CharacterOwner } from './characters.service';
import type { Role } from '@prisma/client';

const ROLE_LABELS: Record<Role, string> = {
  TANK: 'Tank',
  HEALER: 'Healer',
  MELEE_DPS: 'Melee DPS',
  RANGED_DPS: 'Ranged DPS',
};

const SERVER_ONLY = 'This command can only be used inside a server.';
const NO_GUILD = "This server isn't linked to a guild yet.";
const BAD_NAME =
  'Invalid name. Use `Name` or `Name-Lastname` (a dash between first and last name, ' +
  'last name optional), letters only, 2-12 letters each.';

@Injectable()
export class CharactersCommand {
  constructor(private readonly charactersService: CharactersService) {}

  @Command('character-add', { ephemeral: true })
  async add(interaction: DiscordInteraction): Promise<string> {
    const owner = ownerOf(interaction);
    if (!owner) {
      return SERVER_ONLY;
    }
    const name = parseCharacterName(getStringOption(interaction, 'name') ?? '');
    if (!name) {
      return BAD_NAME;
    }
    const characterClass = getStringOption(interaction, 'class') ?? '';
    const role = getStringOption(interaction, 'role') as Role;
    if (!isWowClass(characterClass) || !(role in ROLE_LABELS)) {
      return 'Unknown class or role.';
    }

    const result = await this.charactersService.add(owner, {
      ...name,
      class: characterClass,
      roles: [role],
      isMain: getBooleanOption(interaction, 'main'),
    });
    const label = formatCharacterName(name);
    if (result === 'no-guild') return NO_GUILD;
    if (result === 'duplicate') return `You already have a character named ${label}.`;
    return `Added ${label} (${characterClass}, ${ROLE_LABELS[role]}).`;
  }

  @Command('character-list', { ephemeral: true })
  async list(interaction: DiscordInteraction): Promise<string> {
    const owner = ownerOf(interaction);
    if (!owner) {
      return SERVER_ONLY;
    }
    const characters = await this.charactersService.list(owner);
    if (!characters) return NO_GUILD;
    if (characters.length === 0) return "You haven't registered any characters yet.";

    return characters
      .map((character) => {
        const roles = character.roles.map((role) => ROLE_LABELS[role]).join('/');
        const main = character.isMain ? ' [main]' : '';
        return `${formatCharacterName(character)} - ${character.class} (${roles}), level ${character.level}${main}`;
      })
      .join('\n');
  }

  @Command('character-remove', { ephemeral: true })
  async remove(interaction: DiscordInteraction): Promise<string> {
    const owner = ownerOf(interaction);
    if (!owner) {
      return SERVER_ONLY;
    }
    const name = parseCharacterName(getStringOption(interaction, 'name') ?? '');
    if (!name) {
      return BAD_NAME;
    }

    const result = await this.charactersService.remove(owner, name);
    const label = formatCharacterName(name);
    if (result === 'no-guild') return NO_GUILD;
    if (result === 'not-found') return `You don't have a character named ${label}.`;
    return `Removed ${label}.`;
  }
}

function ownerOf(interaction: DiscordInteraction): CharacterOwner | null {
  const discordUserId = getInvokerId(interaction);
  if (!interaction.guild_id || !discordUserId) {
    return null;
  }
  return { discordServerId: interaction.guild_id, discordUserId };
}
