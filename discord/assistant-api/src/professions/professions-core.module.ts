import { Module } from '@nestjs/common';
import { PluginsCoreModule } from '../plugins/plugins-core.module';
import { GuildRecipesService } from './guild-recipes.service';
import { ProfessionsPostPlugin } from './professions-post.plugin';
import { WowheadService } from './wowhead.service';

/**
 * What the background worker needs of professions: only the database and the bot. It also adds the
 * Professions List plugin kind, so both the API (Plugins tab) and the worker (runs) know it.
 */
@Module({
  imports: [PluginsCoreModule],
  providers: [WowheadService, GuildRecipesService, ProfessionsPostPlugin],
  exports: [WowheadService, GuildRecipesService, ProfessionsPostPlugin],
})
export class ProfessionsCoreModule {}
