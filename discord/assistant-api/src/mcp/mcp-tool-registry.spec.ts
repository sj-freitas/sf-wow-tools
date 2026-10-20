import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForbiddenException, Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { McpToolRegistry, McpToolRegistryModule, toolResult } from './mcp-tool-registry';

@Injectable()
class FeatureTools {
  constructor(readonly registry: McpToolRegistry) {}
}
@Module({ imports: [McpToolRegistryModule], providers: [FeatureTools], exports: [FeatureTools] })
class FeatureModule {}
@Module({ imports: [McpToolRegistryModule, FeatureModule] })
class AppModule {}

describe('McpToolRegistry', () => {
  it('is one registry for the MCP module and every feature that imports it', async () => {
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    assert.equal(app.get(FeatureTools).registry, app.get(McpToolRegistry));
    await app.close();
  });

  it('turns API errors into tool errors and results into JSON', async () => {
    const ok = await toolResult(async () => ({ id: 'e1' }));
    assert.deepEqual(JSON.parse((ok.content[0] as { text: string }).text), { id: 'e1' });
    const denied = await toolResult(async () => {
      throw new ForbiddenException('Only Officers and EventCreators can create events.');
    });
    assert.equal(denied.isError, true);
    assert.equal(
      (denied.content[0] as { text: string }).text,
      'Only Officers and EventCreators can create events.',
    );
  });
});
