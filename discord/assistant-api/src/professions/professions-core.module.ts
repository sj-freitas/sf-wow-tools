import { Module } from '@nestjs/common';
import { PluginsCoreModule } from '../plugins/plugins-core.module';
import { CrafterListenerService } from './crafter-listener.service';
import { GuildRecipesService } from './guild-recipes.service';
import { ProfessionsPostPlugin } from './professions-post.plugin';
import { WowheadService } from './wowhead.service';

/**
 * What the background worker needs of professions: only the database and the bot. It also adds the
 * Professions List and Guild Chat Profession Listener plugin kinds, so both the API (Plugins tab)
 * and the worker (runs, listening) know them.
 */
@Module({
  imports: [PluginsCoreModule],
  providers: [WowheadService, GuildRecipesService, ProfessionsPostPlugin, CrafterListenerService],
  exports: [WowheadService, GuildRecipesService, ProfessionsPostPlugin, CrafterListenerService],
})
export class ProfessionsCoreModule {}
