import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buttonConfig, createButtonDeployer, MANAGED_RELAY, PLACEHOLDER_DATABASE_ID } from '../src/button';
import { parseTemplate } from '../src/render-config';
import { releaseVersion } from '../src/releases';

const repo = new URL('../../../', import.meta.url).pathname;
const template = readFileSync(join(repo, 'services/api/wrangler.template.jsonc'), 'utf8');
const DATABASE_ID = '11111111-2222-3333-4444-555555555555';

interface Options {
  /** What `wrangler secret list` answers: names, or an error message. */
  secrets?: string[] | { error: string };
  existingQueues?: boolean;
  placeholder?: boolean;
  relay?: boolean;
  built?: boolean;
}

function setup(options: Options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'oc-button-'));
  const temp = mkdtempSync(join(tmpdir(), 'oc-button-temp-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.3.0' }));
  mkdirSync(join(root, 'services/api/.assets'), { recursive: true });
  if (options.built !== false) writeFileSync(join(root, 'services/api/.assets/index.html'), '');
  let config = buttonConfig(template, '0.3.0');
  if (!options.placeholder) config = config.replace(PLACEHOLDER_DATABASE_ID, DATABASE_ID);
  if (options.relay === false) config = config.replace(/"RELAY_URL": "[^"]*",\n/, '');
  writeFileSync(join(root, 'wrangler.jsonc'), config);

  const calls: string[][] = [];
  const uploaded: Record<string, string>[] = [];
  let builds = 0;
  const failure = (stderr: string) => Object.assign(new Error('wrangler failed'), { stderr });
  const deployer = createButtonDeployer(root, {
    tempDir: temp,
    log: () => undefined,
    build: () => void builds++,
    wrangler: (args) => {
      calls.push(args);
      if (args[0] === 'secret') {
        const secrets = options.secrets ?? { error: 'Worker "oc-chat" not found.' };
        if (!Array.isArray(secrets)) throw failure(secrets.error);
        return JSON.stringify(secrets.map((name) => ({ name, type: 'secret_text' })));
      }
      if (args[0] === 'queues' && options.existingQueues) throw failure('Queue name is already taken [code: 11009]');
      const file = args[args.indexOf('--secrets-file') + 1];
      if (args[0] === 'deploy' && args.includes('--secrets-file')) uploaded.push(JSON.parse(readFileSync(file!, 'utf8')) as Record<string, string>);
      return '';
    },
  });
  return { root, temp, deployer, calls, uploaded, builds: () => builds, steps: () => calls.map((c) => c.slice(0, 2).join(' ')) };
}

describe('the committed button config', () => {
  it('is what the template generates, so that the two cannot drift apart', () => {
    expect(readFileSync(join(repo, 'wrangler.jsonc'), 'utf8')).toBe(buttonConfig(template, releaseVersion(repo)));
  });

  it('has paths from the repository root, a placeholder database, and the project relay', () => {
    const config = parseTemplate(buttonConfig(template, '0.3.0'));
    expect(config.main).toBe('services/api/src/index.ts');
    expect(existsSync(join(repo, config.main))).toBe(true);
    expect(config.assets?.directory).toBe('services/api/.assets');
    expect(config.d1_databases?.[0]).toMatchObject({ binding: 'DB', database_id: PLACEHOLDER_DATABASE_ID, migrations_dir: 'packages/database/migrations' });
    expect(existsSync(join(repo, config.d1_databases![0]!.migrations_dir!))).toBe(true);
    expect(config.vars).toMatchObject({ RELAY_URL: MANAGED_RELAY.url, RELAY_ID: 'managed', OPENCHAT_VERSION: '0.3.0' });
    expect(config.analytics_engine_datasets).toBeUndefined();
  });
});

describe('button-deploy', () => {
  it('on a first deploy creates queues, migrates, and deploys with new signing keys that leave no file behind', async () => {
    const t = setup();
    await t.deployer.deploy();
    const steps = t.steps();
    expect(steps.filter((s) => s === 'queues create')).toHaveLength(6);
    expect(steps.slice(-2)).toEqual(['d1 migrations', 'deploy -c']);
    expect(t.calls.find((c) => c[0] === 'd1')).toEqual(['d1', 'migrations', 'apply', 'DB', '--remote', '-c', join(t.root, 'wrangler.jsonc')]);
    expect(Object.keys(t.uploaded[0]!).sort()).toEqual(['AUTH_SIGNING_KEY', 'RELAY_SIGNING_KEY']);
    const key = JSON.parse(t.uploaded[0]!.AUTH_SIGNING_KEY!) as { active: { kid: string; privateKey: string; publicKey: string } };
    expect(key.active.kid).toMatch(/^key-/);
    expect(key.active.privateKey).not.toBe('');
    expect(readdirSync(t.temp)).toEqual([]);
    expect(t.builds()).toBe(0);
  });

  it('generates only the keys that are missing when Cloudflare made the Worker first', async () => {
    const t = setup({ secrets: ['SETUP_CODE'] });
    await t.deployer.deploy();
    expect(Object.keys(t.uploaded[0]!).sort()).toEqual(['AUTH_SIGNING_KEY', 'RELAY_SIGNING_KEY']);
  });

  it('never replaces a key on a later deploy', async () => {
    const t = setup({ secrets: ['SETUP_CODE', 'AUTH_SIGNING_KEY', 'RELAY_SIGNING_KEY'] });
    await t.deployer.deploy();
    expect(t.steps()).toEqual(['secret list', 'd1 migrations', 'deploy -c']);
    expect(t.uploaded).toEqual([]);
    expect(t.calls.at(-1)).not.toContain('--secrets-file');
  });

  it('adds the relay key later without touching the signing key', async () => {
    const t = setup({ secrets: ['AUTH_SIGNING_KEY'] });
    await t.deployer.deploy();
    expect(Object.keys(t.uploaded[0]!)).toEqual(['RELAY_SIGNING_KEY']);
  });

  it('makes no relay key for a deployment without a relay', async () => {
    const t = setup({ relay: false });
    await t.deployer.deploy();
    expect(Object.keys(t.uploaded[0]!)).toEqual(['AUTH_SIGNING_KEY']);
  });

  it('stops, deploying nothing, when it cannot tell which secrets exist', async () => {
    const t = setup({ secrets: { error: 'Authentication error [code: 10000]' } });
    await expect(t.deployer.deploy()).rejects.toThrow(/nothing was deployed/);
    expect(t.steps()).toEqual(['secret list']);
  });

  it('carries on when the queues already exist', async () => {
    const t = setup({ existingQueues: true });
    await t.deployer.deploy();
    expect(t.steps().at(-1)).toBe('deploy -c');
  });

  it('refuses the committed placeholder, which only the button fills in', async () => {
    const t = setup({ placeholder: true });
    await expect(t.deployer.deploy()).rejects.toThrow(/placeholder database ID/);
    expect(t.calls).toEqual([]);
  });

  it('builds first if nothing has been built', async () => {
    const t = setup({ built: false });
    await t.deployer.deploy();
    expect(t.builds()).toBe(1);
  });
});
