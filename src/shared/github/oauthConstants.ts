/**
 * Placeholder OAuth callback URL for GitHub / GHE app registration.
 * Vyotiq Device Flow does not use redirects; hosts still require a value.
 */
export const GITHUB_OAUTH_CALLBACK_PLACEHOLDER = 'http://localhost';

/**
 * Vyotiq OAuth App client ID (public) for GitHub Device Flow.
 *
 * Register once at github.com → Settings → Developer settings → OAuth Apps
 * (enable Device Flow, callback `http://localhost`), then paste the Client ID here.
 * End users click "Sign in with GitHub" — they never register an app themselves.
 */
export const BUNDLED_GITHUB_OAUTH_CLIENT_ID = '';

/** Fine-grained / classic PAT creation — scopes match Device Flow defaults. */
export const GITHUB_NEW_TOKEN_URL =
  'https://github.com/settings/tokens/new?description=Vyotiq&scopes=repo,read:org,read:user';
