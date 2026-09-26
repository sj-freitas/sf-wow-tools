/** The collapsible help about `{{reactions …}}` tags in a message's text. */
export function LiveTagsHelp() {
  return (
    <details className="syntax-help">
      <summary title="Show who reacted to a message inside this post">
        ⓘ Show who reacted (live tags)
      </summary>

      <h5>What it does</h5>
      <p>
        Put a tag in a message's text and the bot replaces it with the people who reacted to a
        message, then keeps it up to date (within a minute of a reaction changing).
      </p>
      <pre className="md-code">
        {'Signed up: {{reactions sourcePost=123456789012345678 emoji=👍}}'}
      </pre>

      <h5>The options</h5>
      <table className="syntax-table">
        <tbody>
          <tr>
            <th>
              <code>sourcePost</code>
            </th>
            <td>
              The message to read. Use its <strong>message id</strong> (Discord: right-click the
              message → Copy Message ID), or its <strong>link</strong> (Copy Message Link), or the{' '}
              <strong>name</strong> of a scheduled post. Leave it out to read this post.
            </td>
          </tr>
          <tr>
            <th>
              <code>part</code>
            </th>
            <td>
              For a post with several messages: which one to read, counting from 1 (
              <code>part=2</code>). Left out, a tag reads the message it is written in, or the first
              message of another post.
            </td>
          </tr>
          <tr>
            <th>
              <code>emoji</code>
            </th>
            <td>
              Which reaction to list: 👍, or a server emoji as <code>&lt;:name:id&gt;</code>.
            </td>
          </tr>
          <tr>
            <th>
              <code>show</code>
            </th>
            <td>
              What to write, as a JavaScript expression (see below). Leave it out to list the names.
              Put it in quotes when it has spaces.
            </td>
          </tr>
        </tbody>
      </table>

      <h5>
        What <code>show</code> can use: <code>reactions</code>
      </h5>
      <p>
        <code>reactions</code> is a <strong>list</strong> (an array) with one entry for each person
        who reacted. Each entry is an <strong>object</strong> with these fields:
      </p>
      <table className="syntax-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>What it is</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>id</code>
            </td>
            <td>text</td>
            <td>Their Discord user id.</td>
          </tr>
          <tr>
            <td>
              <code>tag</code>
            </td>
            <td>text</td>
            <td>A mention of them, like @Ana. Nobody gets pinged.</td>
          </tr>
          <tr>
            <td>
              <code>name</code>
            </td>
            <td>text</td>
            <td>Their Discord name.</td>
          </tr>
          <tr>
            <td>
              <code>displayName</code>
            </td>
            <td>text</td>
            <td>Their nickname in the message's server (their Discord name if none).</td>
          </tr>
          <tr>
            <td>
              <code>characters</code>
            </td>
            <td>list of objects</td>
            <td>
              Their characters in the guild, main first (an empty list if they have none). Each one
              is described below.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Each entry of <code>characters</code> is an <strong>object</strong> too:
      </p>
      <table className="syntax-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>What it is</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>name</code>
            </td>
            <td>text</td>
            <td>The character's name, like Merric Stone.</td>
          </tr>
          <tr>
            <td>
              <code>firstName</code>, <code>lastName</code>
            </td>
            <td>text</td>
            <td>The two parts of the name (the last name is empty if there is none).</td>
          </tr>
          <tr>
            <td>
              <code>isMain</code>
            </td>
            <td>true / false</td>
            <td>Whether this is one of their mains.</td>
          </tr>
          <tr>
            <td>
              <code>class</code>
            </td>
            <td>text</td>
            <td>Their class, like Warrior.</td>
          </tr>
          <tr>
            <td>
              <code>roles</code>
            </td>
            <td>list of text</td>
            <td>Tank, Healer, Melee DPS and/or Ranged DPS.</td>
          </tr>
          <tr>
            <td>
              <code>level</code>
            </td>
            <td>number</td>
            <td>Their level.</td>
          </tr>
        </tbody>
      </table>
      <p>
        The result can be text or a list (a list is joined with commas). Put the expression in
        quotes: <code>show="…"</code>.
      </p>

      <h5>Examples</h5>
      <table className="syntax-table">
        <tbody>
          <tr>
            <td>
              <code>show="reactions.length"</code>
            </td>
            <td>How many: 3</td>
          </tr>
          <tr>
            <td>
              <code>show="reactions.map(r =&gt; r.tag)"</code>
            </td>
            <td>Mentions: @Ana, @Bruno</td>
          </tr>
          <tr>
            <td>
              <code>
                show="reactions.map(r =&gt; (r.characters.find(c =&gt; c.isMain) || r).name)"
              </code>
            </td>
            <td>Each person's main character, or their Discord name if they have none</td>
          </tr>
          <tr>
            <td>
              <code>
                show="reactions.flatMap(r =&gt; r.characters).filter(c =&gt;
                c.roles.includes('Tank')).map(c =&gt; c.name)"
              </code>
            </td>
            <td>Every tank character: Merric Stone, Olga</td>
          </tr>
          <tr>
            <td>
              <code>{'show="`${reactions.length}: ${reactions.map(r => r.name)}`"'}</code>
            </td>
            <td>A count and the names: 2: Ana,Bruno</td>
          </tr>
        </tbody>
      </table>
      <p className="muted">
        The expression runs in a safe sandbox (no files or network) and is checked when you save. If
        you need a double quote inside it, write <code>\"</code>, or use single quotes.
      </p>
    </details>
  );
}
