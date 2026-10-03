/**
 * GitHub's CLI omits avatar URLs from issue and pull-request actors. A plain user login still
 * has a stable image endpoint on both github.com and GitHub Enterprise hosts.
 *
 * Apps such as `dependabot[bot]` do not name a page at this path, so they keep the generic avatar
 * instead of receiving a guessed URL that will fail to load.
 */
export function gitHubLoginAvatarUrl(login: string, host: string): string | null {
  return /^[a-z0-9][a-z0-9-]{0,38}$/iu.test(login) ? `https://${host}/${login}.png?size=80` : null;
}
