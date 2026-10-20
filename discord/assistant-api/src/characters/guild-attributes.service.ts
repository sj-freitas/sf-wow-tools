import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

/** The colours an attribute can have, by name (the backoffice turns them into actual colours). */
export const ATTRIBUTE_COLORS = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'purple',
  'pink',
] as const;
export type AttributeColor = (typeof ATTRIBUTE_COLORS)[number];

export const MAX_ATTRIBUTE_NAME = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AttributeDto {
  id: string;
  name: string;
  color: AttributeColor;
  /** The characters (of the roster) that have it. */
  characterIds: string[];
}

export interface AttributeInput {
  name?: unknown;
  color?: unknown;
}

/**
 * A guild's attributes: labels with a colour that Officers give characters on the roster
 * ("Switcher", "Recruit"…). As many as the guild wants; names are unique in the guild, colours can
 * repeat. Everyone in the guild sees them; roster post tags read them as `roster[i].attributes`.
 * Permission checks are the caller's.
 */
@Injectable()
export class GuildAttributesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(guildId: string): Promise<AttributeDto[]> {
    const attributes = await this.prisma.guildAttribute.findMany({
      where: { guildId },
      orderBy: { name: 'asc' },
      include: {
        // Only characters on the roster: one that left keeps its attributes for when it is back.
        characters: {
          where: { character: { guilds: { some: { guildId } } } },
          select: { characterId: true },
        },
      },
    });
    return attributes.map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
      color: attribute.color as AttributeColor,
      characterIds: attribute.characters.map((link) => link.characterId),
    }));
  }

  async create(guildId: string, input: AttributeInput): Promise<void> {
    const name = this.name(input.name);
    const color = this.color(input.color);
    await this.unique(() => this.prisma.guildAttribute.create({ data: { guildId, name, color } }));
    this.changed(guildId);
  }

  async update(guildId: string, attributeId: string, input: AttributeInput): Promise<void> {
    await this.find(guildId, attributeId);
    const data = {
      ...(input.name !== undefined ? { name: this.name(input.name) } : {}),
      ...(input.color !== undefined ? { color: this.color(input.color) } : {}),
    };
    await this.unique(() =>
      this.prisma.guildAttribute.update({ where: { id: attributeId }, data }),
    );
    this.changed(guildId);
  }

  /** Deletes the attribute, and takes it off every character. */
  async delete(guildId: string, attributeId: string): Promise<void> {
    await this.find(guildId, attributeId);
    await this.prisma.guildAttribute.delete({ where: { id: attributeId } });
    this.changed(guildId);
  }

  /** Sets exactly which of the guild's attributes a character on its roster has. */
  async setForCharacter(
    guildId: string,
    characterId: string,
    attributeIds: readonly string[],
  ): Promise<void> {
    const onRoster = UUID.test(characterId)
      ? await this.prisma.characterGuildMembership.findUnique({
          where: { characterId_guildId: { characterId, guildId } },
          select: { id: true },
        })
      : null;
    if (!onRoster) throw new NotFoundException('That character is not on the roster.');
    const wanted = [...new Set(attributeIds)];
    const known = await this.prisma.guildAttribute.findMany({
      where: { guildId, id: { in: wanted.filter((id) => UUID.test(id)) } },
      select: { id: true },
    });
    if (known.length !== wanted.length) {
      throw new BadRequestException('One of the attributes no longer exists. Reload the page.');
    }
    await this.prisma.$transaction([
      this.prisma.characterAttribute.deleteMany({
        where: { characterId, attribute: { guildId } },
      }),
      this.prisma.characterAttribute.createMany({
        data: wanted.map((attributeId) => ({ attributeId, characterId })),
      }),
    ]);
    this.changed(guildId);
  }

  private name(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : '';
    if (name === '') throw new BadRequestException('Give the attribute a name.');
    if (name.length > MAX_ATTRIBUTE_NAME) {
      throw new BadRequestException(`A name can be at most ${MAX_ATTRIBUTE_NAME} characters.`);
    }
    return name;
  }

  private color(value: unknown): AttributeColor {
    if (typeof value !== 'string' || !(ATTRIBUTE_COLORS as readonly string[]).includes(value)) {
      throw new BadRequestException('Pick one of the colours.');
    }
    return value as AttributeColor;
  }

  private async find(guildId: string, attributeId: string): Promise<void> {
    const found = UUID.test(attributeId)
      ? await this.prisma.guildAttribute.findFirst({
          where: { id: attributeId, guildId },
          select: { id: true },
        })
      : null;
    if (!found) throw new NotFoundException('That attribute no longer exists.');
  }

  /** Runs a write, turning a clash of names into a readable message. */
  private async unique(write: () => Promise<unknown>): Promise<void> {
    try {
      await write();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('The guild already has an attribute with that name.');
      }
      throw error;
    }
  }

  private changed(guildId: string): void {
    this.realtime.publish(guildId, 'characters');
  }
}
