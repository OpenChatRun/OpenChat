/**
 * The Deploy to Cloudflare button. Cloudflare copies this repository into the person's own Git account, creates
 * the database, bucket and queues named in the root wrangler.jsonc, writes their IDs into that file, and then runs
 * the root package.json's `build` and `deploy` scripts. `deploy` is `buttonDeploy` below. Nobody is at a terminal,
 * so it creates the signing keys itself, and the first admin is made in the browser. See ADR-0020 and
 * docs/operations/one-click-deploy.md.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { generateSerializedKey } from '@openchat/auth';
import { parseTemplate, renderConfig } from './render-config';
import { releaseVersion } from './releases';
import { describeFailure, type RunWrangler, wranglerIn } from './wrangler';

/** The name in the committed config. The button lets each person choose their own. */
export const BUTTON_NAME = 'chat';
/** Replaced by Cloudflare with the ID of the database it creates. */
export const PLACEHOLDER_DATABASE_ID = '00000000-0000-0000-0000-000000000000';
/** The project's relay, which is open to every installation, so that push works with the official app from the start. */
export const MANAGED_RELAY = { url: 'https://openchat-relay.orangolabs.com', id: 'managed', bundleIds: 'com.orangolabs.openchat' };

const HEADER = `// The Deploy to Cloudflare button reads this file. See docs/operations/one-click-deploy.md.
// Generated from services/api/wrangler.template.jsonc by \`pnpm oc button-config\`, and checked by a test, so
// change the template and generate again. Local development and \`pnpm oc deploy\` do not use this file.
`;

/** The root wrangler.jsonc: the Worker's template, with paths from the repository root and the project's relay. */
export function buttonConfig(templateSource: string, release: string): string {
  const rendered = renderConfig(templateSource, { name: BUTTON_NAME, d1DatabaseId: PLACEHOLDER_DATABASE_ID, relay: MANAGED_RELAY }, 'services/api', release);
  for (const db of rendered.d1_databases ?? []) if (db.migrations_dir) db.migrations_dir = posix.normalize(db.migrations_dir);
  return `${HEADER}${JSON.stringify(rendered, null, 2)}\n`;
}

export interface ButtonDeps {
  wrangler?: RunWrangler;
  log?: (line: string) => void;
  build?: () => void;
  /** Where the secrets file is written for the moment Wrangler reads it. */
  tempDir?: string;
}

const KEYS = [
  { secret: 'AUTH_SIGNING_KEY', prefix: 'key' },
  { secret: 'RELAY_SIGNING_KEY', prefix: 'relay' },
] as const;

export function createButtonDeployer(root: string, deps: ButtonDeps = {}) {
  const wrangler = deps.wrangler ?? wranglerIn(root, '@openchat/api');
  const log = deps.log ?? ((line: string) => console.log(line));
  const build =
    deps.build ??
    (() => {
      execFileSync('pnpm', ['build'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
    });

  /**
   * The names of the secrets the Worker has, or null if there is no Worker yet. Anything else stops the deploy:
   * taking an error for "no secrets" would replace the signing keys, which signs everyone out and breaks push.
   */
  function secretNames(config: string): string[] | null {
    try {
      return (JSON.parse(wrangler(['secret', 'list', '-c', config], { ci: true })) as { name: string }[]).map((secret) => secret.name);
    } catch (error) {
      const detail = describeFailure(error);
      if (/Worker "[^"]*" not found|\b10007\b/.test(detail)) return null;
      throw new Error(`Could not read which secrets the Worker has, so nothing was deployed:\n${detail}`, { cause: error });
    }
  }

  /** Cloudflare creates the queues it finds in the config. This covers any it did not, such as dead-letter queues. */
  function ensureQueues(config: { queues?: { producers?: { queue: string }[]; consumers?: { queue: string; dead_letter_queue?: string }[] } }) {
    const names = new Set([...(config.queues?.producers ?? []).map((p) => p.queue), ...(config.queues?.consumers ?? []).flatMap((c) => [c.queue, ...(c.dead_letter_queue ? [c.dead_letter_queue] : [])])]);
    for (const name of names) {
      try {
        wrangler(['queues', 'create', name], { ci: true });
        log(`Created queue ${name}`);
      } catch (error) {
        const detail = describeFailure(error);
        if (/already exists|already taken|11009/i.test(detail)) continue;
        // Left to the deploy, which names a queue that is really missing.
        log(`Could not create queue ${name}. Carrying on, in case it exists: ${detail.trim().split('\n')[0] ?? ''}`);
      }
    }
  }

  return {
    /** Writes the root wrangler.jsonc from the Worker's template. */
    writeConfig() {
      writeFileSync(join(root, 'wrangler.jsonc'), buttonConfig(readFileSync(join(root, 'services/api/wrangler.template.jsonc'), 'utf8'), releaseVersion(root)));
    },

    /**
     * Migrations, then the Worker. The same on a first deploy and on every later push: migrations are
     * expand/contract, so the Worker that is still running can use the new schema until the new one is live.
     */
    async deploy(options: { configPath?: string | undefined } = {}) {
      const configFile = options.configPath ?? join(root, 'wrangler.jsonc');
      const config = parseTemplate(readFileSync(configFile, 'utf8'));
      if (config.d1_databases?.some((db) => db.database_id === PLACEHOLDER_DATABASE_ID)) {
        throw new Error('wrangler.jsonc still has the placeholder database ID. This script is for the Deploy to Cloudflare button, which fills it in. To deploy from your own computer, use pnpm oc deploy.');
      }
      if (!existsSync(join(root, 'services/api/.assets/index.html'))) {
        log('Building');
        build();
      }

      const present = secretNames(configFile);
      const vars = (config.vars ?? {}) as Record<string, string>;
      const wanted = KEYS.filter((key) => key.secret !== 'RELAY_SIGNING_KEY' || vars.RELAY_URL);
      const missing = wanted.filter((key) => !present?.includes(key.secret));
      if (!present?.includes('AUTH_SIGNING_KEY')) ensureQueues(config);

      log('Applying migrations');
      wrangler(['d1', 'migrations', 'apply', 'DB', '--remote', '-c', configFile], { ci: true });

      if (missing.length === 0) {
        log('Deploying the Worker');
        wrangler(['deploy', '-c', configFile], { ci: true });
      } else {
        // Only ever for a secret the Worker does not have: a new signing key would sign everyone out.
        log(`Generating ${missing.map((key) => key.secret).join(' and ')}`);
        const secrets: Record<string, string> = {};
        for (const key of missing) secrets[key.secret] = JSON.stringify({ active: await generateSerializedKey(`${key.prefix}-${Date.now().toString(36)}`) });
        const dir = mkdtempSync(join(deps.tempDir ?? tmpdir(), 'oc-secrets-'));
        const file = join(dir, 'secrets.json');
        try {
          writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
          log('Deploying the Worker');
          wrangler(['deploy', '-c', configFile, '--secrets-file', file], { ci: true });
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }
      if (!present?.includes('SETUP_CODE')) {
        log('\nNo SETUP_CODE secret is set, so the first admin cannot be created in the browser. Add one to the Worker under Settings, Variables and Secrets, then open the Worker’s address.');
      }
      log('\nDeployed. Open the Worker’s address to finish setting up.');
    },
  };
}
