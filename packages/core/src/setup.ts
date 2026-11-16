/**
 * First-time setup from the browser. An installation made with the Deploy to Cloudflare button has no
 * `oc deploy` to create its first owner, so the person who deployed it does that here, once, by proving they
 * know the setup code they chose while deploying. See ADR-0020 and docs/operations/one-click-deploy.md.
 */
import { hashPassword, MIN_PASSWORD_LENGTH } from '@openchat/auth';
import { createFirstInstallation, getInstallation, type Database } from '@openchat/database';
import { AppError, type AbuseLimits } from '@openchat/shared';
import { enforce, limitKeyForIp, type RateLimiter } from './auth-flows';

export const SETUP_LIMITS = {
  setupIp: { limit: 10, windowSeconds: 15 * 60 },
  /**
   * Across every address, because the code is chosen by a person and may be short. At this rate even a
   * six-digit code takes years to guess. The cost is that a flood of guesses can delay the real setup.
   */
  setupAll: { limit: 30, windowSeconds: 60 * 60 },
} as const;

export type SetupStatus = 'ready' | 'needed' | 'unconfigured';

export interface SetupDeps {
  db: Database;
  limiter: RateLimiter;
  limits: AbuseLimits;
  /** The SETUP_CODE secret. Without one, setup from the browser does not exist. */
  setupCode: string | undefined;
}

const usable = (code: string | undefined): code is string => typeof code === 'string' && code.trim() !== '';

/** `ready` once an installation exists, whoever made it. `unconfigured` means nobody can set it up from here. */
export async function setupStatus(deps: Pick<SetupDeps, 'db' | 'setupCode'>): Promise<SetupStatus> {
  if (await getInstallation(deps.db)) return 'ready';
  return usable(deps.setupCode) ? 'needed' : 'unconfigured';
}

async function sameCode(presented: string, expected: string): Promise<boolean> {
  const digest = (value: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return crypto.subtle.timingSafeEqual(await digest(presented), await digest(expected));
}

function slugFor(name: string): string {
  const base = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const suffix = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${base || 'workspace'}-${suffix}`;
}

export interface SetupInput {
  setupCode: string;
  /** The company. Names the installation and its first workspace. */
  name: string;
  ownerName: string;
  email: string;
  password: string;
  /** The origin the request came to, which becomes the installation's address in links it sends. */
  origin: string;
  ip: string;
}

/**
 * Answers 404 unless setup is needed, so that a finished installation shows no sign of this. A wrong code is
 * counted before it is compared, and the password is hashed only for a right one.
 */
export async function setupInstallation(deps: SetupDeps, input: SetupInput): Promise<void> {
  const gone = () => new AppError(404, 'not_found', 'Not found');
  if (!usable(deps.setupCode) || (await getInstallation(deps.db))) throw gone();
  await enforce(deps.limiter, await limitKeyForIp(deps, 'setup-ip', input.ip), SETUP_LIMITS.setupIp);
  await enforce(deps.limiter, 'setup-all', SETUP_LIMITS.setupAll);
  if (!(await sameCode(input.setupCode, deps.setupCode.trim()))) throw new AppError(403, 'wrong_setup_code', 'That setup code is not right');
  if (input.password.length < MIN_PASSWORD_LENGTH) throw new AppError(400, 'password_too_short', 'Choose a longer password');
  const created = await createFirstInstallation(deps.db, {
    name: input.name,
    publicBaseUrl: input.origin,
    ownerEmail: input.email,
    ownerName: input.ownerName,
    passwordHash: await hashPassword(input.password),
    workspaceSlug: slugFor(input.name),
  });
  if (!created) throw gone();
}
