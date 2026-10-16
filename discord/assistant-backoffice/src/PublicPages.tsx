import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { fetchPublicInfo, rememberReturnPath } from './api';
import type { PublicInfo } from './types';
import { usePageMeta } from './usePageMeta';

/** The public info (bot invite link, contact), loaded once; null until it arrives or if it fails. */
function usePublicInfo(): PublicInfo | null {
  const [info, setInfo] = useState<PublicInfo | null>(null);
  useEffect(() => {
    fetchPublicInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);
  return info;
}

/** Full-page navigation: the API redirects to Discord's own login page and back. */
function LoginLink({ className }: { className: string }) {
  return (
    <a className={className} href="/api/auth/login" onClick={rememberReturnPath}>
      Log in with Discord
    </a>
  );
}

/** The frame every public page shares: our own name up top, the privacy link and disclaimer below. */
function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <div className="public">
      <header className="public-bar">
        <Link className="brand" to="/">
          <span className="brand-mark">
            <img src="/logo.png" alt="" />
          </span>
          Guild Assistant
        </Link>
        <LoginLink className="btn btn-sm" />
      </header>
      <main className="public-main">{children}</main>
      <footer className="public-footer">
        <span>Guild Assistant</span>
        <Link to="/privacy">Privacy policy</Link>
        <span>
          A fan-made tool. Not affiliated with or endorsed by Blizzard Entertainment or Discord.
        </span>
      </footer>
    </div>
  );
}

const FEATURES: { title: string; text: string }[] = [
  {
    title: 'Roster and characters',
    text: 'Every member registers their characters — class, race, roles, level, main or alt — from the website or with a slash command in Discord. Officers see the whole roster and its ranks at a glance.',
  },
  {
    title: 'Event sign-ups',
    text: 'Create a raid with a slash command or on the website. Members sign up with one of their characters from Discord; organisers build the groups and post assignments, and remind whoever hasn’t answered.',
  },
  {
    title: 'Scheduled posts that stay up to date',
    text: 'Write announcements once, schedule them, and let them update themselves: who reacted, which roles are covered, or any slice of the roster.',
  },
  {
    title: 'Character pages and RP bios',
    text: 'Each character gets its own page. On roleplay servers, players can write a bio with images and choose whether to share it.',
  },
  {
    title: 'Messages to the officers',
    text: 'Members write to the officer team with a slash command, anonymously if they prefer; officers answer from the website and the reply arrives as a private message.',
  },
  {
    title: 'Spam protection',
    text: 'Honeypot channels catch spam bots: anything that posts there is banned automatically, with a test mode to try it out first.',
  },
  {
    title: 'Built around your Discord roles',
    text: 'Officers, raiders and socials are read from your server’s roles, so permissions follow what you already manage in Discord.',
  },
];

/** `/` (and any other address) before logging in: what the site is, and how to start. */
export function PublicHome() {
  const info = usePublicInfo();
  // Only `/` itself is the landing page as far as search engines go; any other address showing it
  // (a deep link while logged out) would be a duplicate.
  const isHome = useLocation().pathname === '/';
  usePageMeta({ path: '/', index: isHome });
  return (
    <PublicFrame>
      <section className="hero">
        <div className="hero-logo">
          <img src="/logo.png" alt="" />
        </div>
        <h1>Guild Assistant</h1>
        <p className="hero-tagline">
          A helper for World of Warcraft guilds that organise on Discord: keep your roster, schedule
          raid sign-ups and announcements, and look after your server — from one website and a
          Discord bot.
        </p>
        <div className="hero-actions">
          {info && (
            <a
              className="btn btn-primary btn-lg"
              href={info.botInviteUrl}
              target="_blank"
              rel="noreferrer"
            >
              Add the bot to your server
            </a>
          )}
          <LoginLink className="btn btn-lg" />
        </div>
      </section>

      <h2>What it does</h2>
      <div className="feature-grid">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="feature">
            <h3>{feature.title}</h3>
            <p>{feature.text}</p>
          </div>
        ))}
      </div>

      <h2>Event sign-ups, step by step</h2>
      <p className="section-intro">
        Like a raid sign-up bot, built in: events your members answer from Discord or the website,
        with the raid groups and assignments in the same place.
      </p>
      <ol className="steps">
        <li>
          <strong>Set it up once.</strong> On the website’s Events page, an officer picks the
          channel where events are posted and, if they like, an <em>EventCreator</em> role for
          members who may create events too. Officers always can.
        </li>
        <li>
          <strong>Create an event</strong> with <code>/create-event</code> in Discord, or from the
          website with a date picker. Give it a name, a date and a time (in server time unless you
          choose another timezone; Discord shows everyone their own), and a description. Choose its
          type:
          <ul>
            <li>
              <strong>Characters</strong>, for raids: people sign up with one of their characters
              and a role.
            </li>
            <li>
              <strong>Members</strong>, for everything else: people sign up as themselves.
            </li>
          </ul>
        </li>
        <li>
          <strong>Members answer from the post.</strong> <em>Sign up</em> offers their characters on
          your realm, in each role they play, and one pick does it. <em>Late</em> and{' '}
          <em>Tentative</em> let them leave a note for the organisers, and <em>Absent</em> says they
          can’t come. The post keeps itself up to date: who is coming, sorted by Tank, Healer,
          Ranged and Melee, each with their class icon and sign-up number.
        </li>
        <li>
          <strong>Organise it on the website.</strong> Drag the people who signed up into raid
          groups, or into the invited list for a members event, and post it to Discord, pinging them
          if you like. Write assignments (“Darkshivan heals Tearyn”, “Arthas tanks Skull”), with
          images, and post them in the event’s channel; copy them from an earlier event to save
          time. Remind whoever hasn’t answered with a direct message, one by one or all at once.
        </li>
        <li>
          <strong>Close and keep it.</strong> Sign-ups close on their own when the event starts, or
          by hand. Archiving an event clears it from Discord and keeps its sign-ups, groups and
          assignments as history you can search by date.
        </li>
      </ol>

      <h2>Getting started</h2>
      <ol className="steps">
        <li>Add the bot to your guild’s Discord server.</li>
        <li>
          Give yourself the <strong>{info?.adminRoleName ?? 'Guild-Assistant'}</strong> role in that
          server.
        </li>
        <li>
          Log in here with your Discord account and set the guild up: its name, realm, faction and
          officer role. Your members can then log in and add their characters.
        </li>
      </ol>
    </PublicFrame>
  );
}

/**
 * `/privacy`: readable by anyone. Logged out it has the public frame; logged in (`framed` false) it
 * sits inside the app instead, without a "Log in" button.
 */
export function PrivacyPage({ framed = true }: { framed?: boolean }) {
  const info = usePublicInfo();
  usePageMeta({ title: 'Privacy policy', path: '/privacy', index: true });
  const article = (
    <article className="prose">
      <h1>Privacy policy</h1>
      <p className="muted">Last updated 15 October 2026</p>

      <p>
        Guild Assistant is a fan-made tool for World of Warcraft guilds that use Discord. This page
        explains what it stores about you, why, and how to have it removed.
      </p>

      <h2>Logging in</h2>
      <p>
        You log in on Discord’s own website; Guild Assistant never sees your Discord password.
        Discord tells us your account id, username, display name and avatar, and which servers you
        are in and your roles there — that is how we know which guilds you belong to and what you
        may manage. We keep your Discord access token, encrypted, so the site can re-check your
        servers and roles while you are logged in. Your session lasts 7 days, or until you log out.
      </p>

      <h2>What you and your guild add</h2>
      <ul>
        <li>Guild details: name, realm, faction, settings, welcome text and banner.</li>
        <li>
          Characters: name, class, race, level, roles, and, if you write one, a bio and its images.
          A bio is private until you choose to share it.
        </li>
        <li>
          Notes a guild’s officers keep about the characters on its roster, with any images they
          add. Only that guild’s officers can see them.
        </li>
        <li>
          Messages to the officers and the officers’ replies, with any image attached. If you choose
          to stay anonymous, your name is not shown to the officers; your Discord id is still kept
          so replies can reach you.
        </li>
        <li>Scheduled posts and their images, and who reacted to them.</li>
        <li>
          Events: who signed up, with which character and role, any note left for the organisers,
          the raid groups and assignments, and when an organiser sent you a reminder.
        </li>
        <li>
          Spam protection: when someone posts in a honeypot channel, their Discord id and username
          are logged with what was done.
        </li>
      </ul>

      <h2>What we don’t do</h2>
      <p>
        No advertising, no analytics or tracking scripts, and nothing is sold or shared for
        marketing. The only cookies are the ones that keep you logged in.
      </p>

      <h2>Who processes the data</h2>
      <p>
        The site runs on Render, with its database on Supabase, behind Cloudflare. Discord provides
        the login and the bot. When an officer uses the armory lookup, public character data is read
        from Blizzard’s Battle.net API.
      </p>

      <h2>Removing your data</h2>
      <p>
        You can clear your bio, and take your characters off a guild’s roster, at any time. Removing
        a guild deletes its posts, messages, settings and spam-protection logs. Characters belong to
        you rather than to a guild, so they are kept for your other guilds; to have them, or any of
        your data, deleted entirely,
        {info?.contactEmail ? (
          <>
            {' '}
            write to <a href={`mailto:${info.contactEmail}`}>{info.contactEmail}</a>.
          </>
        ) : (
          ' contact your guild’s officers or the person who runs this site.'
        )}
      </p>
    </article>
  );
  return framed ? (
    <PublicFrame>{article}</PublicFrame>
  ) : (
    <div className="card card-body">{article}</div>
  );
}
