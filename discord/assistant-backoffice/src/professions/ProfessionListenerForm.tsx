import { useState, type FormEvent } from 'react';
import { channelKey, splitChannelKey } from '../channelKey';
import { ChannelSelect } from '../ChannelSelect';
import { PluginFormFrame, type PluginFormProps } from '../plugins/PluginFormFrame';
import { usePluginSave } from '../plugins/usePluginSave';
import { useChannels } from '../useChannels';

/** What it listens for unless an Officer says otherwise (the API's DEFAULT_PHRASES). */
const DEFAULT_PHRASES = [
  'who can craft',
  'who can make',
  'who crafts',
  'who makes',
  'can anyone craft',
  'can anyone make',
  'can someone craft',
  'can someone make',
  'anyone can craft',
  'anyone can make',
  'lf crafter',
  'lf craft',
  'looking for crafter',
  'looking for a crafter',
  'need a crafter',
  'need crafter',
];

/**
 * A Guild Chat Profession Listener's channel, the phrases that make a message a question, and how
 * it answers: a DM to whoever asked, a reply in the channel, or both.
 */
export function ProfessionListenerForm({ guild, editing }: PluginFormProps<'PROFESSION_LISTENER'>) {
  const { channels } = useChannels(guild.id);
  const { save, busy, error, dialog, back } = usePluginSave(guild, 'PROFESSION_LISTENER', editing);
  const [name, setName] = useState(editing?.name ?? '');
  const [channel, setChannel] = useState(
    editing ? channelKey(editing.config.serverId, editing.config.channelId) : '',
  );
  const [phrases, setPhrases] = useState((editing?.config.phrases ?? DEFAULT_PHRASES).join('\n'));
  const [sendDm, setSendDm] = useState(editing?.config.sendDm ?? true);
  const [postInChannel, setPostInChannel] = useState(editing?.config.postInChannel ?? false);

  const usable = channels.filter((group) => group.channels.length > 0 || !group.error);
  const channelLabel = () => {
    const { serverId, channelId } = splitChannelKey(channel);
    const found = channels
      .find((group) => group.serverId === serverId)
      ?.channels.find((c) => c.id === channelId);
    return `#${found?.name ?? channelId}`;
  };
  const how =
    sendDm && postInChannel
      ? 'send them a DM and reply in the channel'
      : postInChannel
        ? 'reply in the channel'
        : 'send them a DM';

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const { serverId, channelId } = splitChannelKey(channel);
    save(
      {
        name: name.trim(),
        config: {
          serverId,
          channelId,
          phrases: phrases
            .split('\n')
            .map((phrase) => phrase.trim())
            .filter(Boolean),
          sendDm,
          postInChannel,
        },
      },
      {
        title: 'Add Guild Chat Profession Listener?',
        message: `The bot will read the messages in ${channelLabel()} and, when someone asks who can craft something the guild can make, ${how} with who can craft it.`,
      },
    );
  };

  return (
    <>
      {dialog}
      <PluginFormFrame
        title={editing ? `Edit ${editing.name}` : 'New Guild Chat Profession Listener'}
        intro="Listens to a channel, like the guild chat. When a message has one of the phrases below and names something the guild can craft (“who can craft flask of titans?”, “LF crafter [Flask of the Titans]”, a Wowhead link), the bot answers with who can craft it, from the professions everyone imported. The game’s guild chat is answered too, whether it’s posted under each player’s linked Discord account or relayed by a bot (then the asker is found by character name)."
        back={back}
        busy={busy}
        error={error}
        editing={!!editing}
        onSubmit={handleSubmit}
      >
        <div className="form-grid form-grid-3">
          <label className="field">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Guild Chat Profession Listener"
            />
          </label>
          <div className="field field-span-2">
            Channel
            <ChannelSelect
              groups={usable}
              value={channel}
              onChange={setChannel}
              required
              check={{ guildId: guild.id, use: postInChannel ? 'answer' : 'listen' }}
            />
          </div>
          <label className="field field-wide">
            Phrases to listen for, one per line
            <textarea
              value={phrases}
              onChange={(e) => setPhrases(e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder={'who can craft\nLF crafter'}
            />
            <span className="muted">
              Two words or more each; capitals and punctuation don’t matter. What follows the phrase
              (or comes before it) is matched against the guild’s recipes, typos and all.
            </span>
          </label>
          <label className="field-toggle">
            <input type="checkbox" checked={sendDm} onChange={(e) => setSendDm(e.target.checked)} />
            Send a DM to whoever asks
          </label>
          <label className="field-toggle field-span-2">
            <input
              type="checkbox"
              checked={postInChannel}
              onChange={(e) => setPostInChannel(e.target.checked)}
            />
            Also post the answer in the channel, as a reply
          </label>
        </div>
      </PluginFormFrame>
    </>
  );
}
