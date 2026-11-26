/**
 * What an installation says about the software it runs, in its discovery document. OpenChat's server is
 * AGPL-3.0-or-later, whose section 13 asks that users of a modified version be offered its source.
 * See docs/operations/licensing.md.
 */
import { isHttpsUrl } from './security-txt';

export const PROJECT_REPOSITORY_URL = 'https://github.com/OrangoLabsLtd/OpenChat';
export const SERVER_LICENSE = 'AGPL-3.0-or-later';

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface Software {
  name: 'OpenChat';
  /** The release `oc deploy` deployed. Null for a Worker deployed some other way. */
  version: string | null;
  license: typeof SERVER_LICENSE;
  /** The operator's own source, if they set one, or the project's at that release. */
  source: string;
}

export function software(options: { version: string | undefined; sourceUrl: string | undefined }): Software {
  const version = options.version && VERSION.test(options.version) ? options.version : null;
  const source = options.sourceUrl && isHttpsUrl(options.sourceUrl) ? options.sourceUrl : version ? `${PROJECT_REPOSITORY_URL}/tree/v${version}` : PROJECT_REPOSITORY_URL;
  return { name: 'OpenChat', version, license: SERVER_LICENSE, source };
}

/** Where the project's newest release is. GitHub redirects this to `.../releases/tag/v<version>`. */
export const LATEST_RELEASE_URL = `${PROJECT_REPOSITORY_URL}/releases/latest`;

const RELEASE_TAG_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/tag\/v(\d+\.\d+\.\d+)$/;

/** The version in the address GitHub redirects `LATEST_RELEASE_URL` to, or null for anything else. */
export function releaseVersionFromUrl(url: string): string | null {
  return RELEASE_TAG_URL.exec(url)?.[1] ?? null;
}

/** Whether release `latest` is newer than the running `current`. A prerelease of a version counts as older than it. */
export function isNewerRelease(latest: string, current: string): boolean {
  if (!VERSION.test(latest) || !VERSION.test(current)) return false;
  const [l, c] = [latest, current].map((v) => v.split('-')[0]!.split('.').map(Number)) as [number[], number[]];
  for (let i = 0; i < 3; i++) if (l[i] !== c[i]) return l[i]! > c[i]!;
  return current.includes('-') && !latest.includes('-');
}
