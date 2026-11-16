/**
 * First-time setup from the browser, for an installation made with the Deploy to Cloudflare button, which has
 * no `oc deploy` to create the first owner. Nothing here takes a WorkspaceContext, because nothing exists yet.
 * See ADR-0020.
 */
import { newId } from '@openchat/shared';
import { DB_NOW_MS, rawHandle, type Database } from './internal/handle';

export interface FirstInstallation {
  name: string;
  publicBaseUrl: string;
  ownerEmail: string;
  ownerName: string;
  passwordHash: string;
  workspaceSlug: string;
}

/**
 * Makes the installation, its first admin, and their workspace, as `oc deploy` does. The installation row is
 * written only into an empty table, and every later row depends on that row being this call's own, so of two
 * calls at once exactly one wins. False means an installation already existed.
 */
export async function createFirstInstallation(database: Database, input: FirstInstallation): Promise<boolean> {
  const d1 = rawHandle(database);
  const installation = newId('installation');
  const user = newId('user');
  const workspace = newId('workspace');
  const mine = `(SELECT id FROM installation) = ?1`;
  const [created] = await d1.batch([
    d1
      .prepare(
        `INSERT INTO installation (id, name, public_base_url, created_at, updated_at)
         SELECT ?1, ?2, ?3, ${DB_NOW_MS}, ${DB_NOW_MS} WHERE NOT EXISTS (SELECT 1 FROM installation)`,
      )
      .bind(installation, input.name, input.publicBaseUrl),
    d1
      .prepare(
        `INSERT INTO users (id, email, name, password_hash, is_installation_admin, created_at, updated_at)
         SELECT ?2, ?3, ?4, ?5, 1, ${DB_NOW_MS}, ${DB_NOW_MS} WHERE ${mine}`,
      )
      .bind(installation, user, input.ownerEmail, input.ownerName, input.passwordHash),
    d1
      .prepare(`INSERT INTO workspaces (id, name, slug, created_at, updated_at) SELECT ?2, ?3, ?4, ${DB_NOW_MS}, ${DB_NOW_MS} WHERE ${mine}`)
      .bind(installation, workspace, input.name, input.workspaceSlug),
    d1
      .prepare(
        `INSERT INTO workspace_members (id, workspace_id, user_id, role, status, created_at, updated_at)
         SELECT ?2, ?3, ?4, 'supervisor', 'active', ${DB_NOW_MS}, ${DB_NOW_MS} WHERE ${mine}`,
      )
      .bind(installation, newId('member'), workspace, user),
    d1
      .prepare(
        `INSERT INTO audit_log (id, workspace_id, actor_type, actor_id, action, target_type, target_id, created_at)
         SELECT ?2, NULL, 'user', ?3, 'installation.created', 'user', ?3, ${DB_NOW_MS} WHERE ${mine}`,
      )
      .bind(installation, newId('audit'), user),
  ]);
  return created?.meta.changes === 1;
}
