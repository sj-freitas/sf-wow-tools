-- Posts used to be one message: config { serverId, channelId, content, seedReactions, embedLinks }
-- and state { messageId, channelId, serverId, postedAt, renderedContent, messageDeleted }.
-- A post is now a list of messages ("parts"): config.parts, and state.messages per part id.
-- Turn every existing post into a post with one message, keeping what is in Discord.
UPDATE "scheduled_tasks" AS t
SET
  "config" = jsonb_build_object(
    'serverId', t."config"->'serverId',
    'channelId', t."config"->'channelId',
    'parts', jsonb_build_array(
      jsonb_build_object(
        'id', p.part_id,
        'content', t."config"->'content',
        'seedReactions', COALESCE(t."config"->'seedReactions', '[]'::jsonb),
        'embedLinks', COALESCE((t."config"->>'embedLinks')::boolean, true),
        'delaySeconds', 0,
        'imageIds', '[]'::jsonb
      )
    )
  ),
  "state" = CASE
    WHEN t."state" ? 'messageId' THEN jsonb_build_object(
      'messages', jsonb_build_array(
        jsonb_strip_nulls(jsonb_build_object(
          'partId', p.part_id,
          'messageId', t."state"->'messageId',
          'channelId', COALESCE(t."state"->'channelId', t."config"->'channelId'),
          'serverId', COALESCE(t."state"->'serverId', t."config"->'serverId'),
          'postedAt', COALESCE(t."state"->'postedAt', to_jsonb(''::text)),
          'renderedContent', COALESCE(t."state"->'renderedContent', t."config"->'content'),
          'imageIds', '[]'::jsonb,
          'embedLinks', COALESCE((t."config"->>'embedLinks')::boolean, true),
          'deleted', CASE WHEN (t."state"->>'messageDeleted')::boolean THEN to_jsonb(true) ELSE NULL END
        ))
      )
    )
    ELSE '{}'::jsonb
  END
FROM (SELECT "id", gen_random_uuid()::text AS part_id FROM "scheduled_tasks") AS p
WHERE p."id" = t."id"
  AND t."type" = 'POST'
  AND t."config" ? 'content'
  AND NOT (t."config" ? 'parts');

-- A tag that read "this post" or a post by name now says which message: the first, unless written otherwise.
UPDATE "post_tracking"
SET "post_ref" = "post_ref" || '#1'
WHERE ("post_ref" = 'self' OR "post_ref" LIKE 'name:%') AND "post_ref" NOT LIKE '%#%';
