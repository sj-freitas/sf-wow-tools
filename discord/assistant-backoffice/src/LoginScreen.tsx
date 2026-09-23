import { DiscordMark } from './DiscordMark';

export function LoginScreen() {
  return (
    <div className="login">
      <div className="login-card">
        <div className="login-logo">
          <img src="/logo.png" alt="Guild Assistant" />
        </div>
        <h1>Guild Assistant</h1>
        <p>
          Manage your guild's players and characters. Sign in with the Discord account you use in
          your guild's server.
        </p>
        {/* Full-page navigation: the API redirects to Discord and back. */}
        <a className="btn btn-primary" href="/api/auth/login">
          <DiscordMark size={22} />
          Log in with Discord
        </a>
      </div>
    </div>
  );
}
