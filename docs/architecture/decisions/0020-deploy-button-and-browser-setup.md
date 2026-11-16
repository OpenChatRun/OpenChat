# ADR-0020: A Deploy to Cloudflare button, with first-time setup in the browser

**Status:** Proposed, 2026-11-15

## Context

Setting up an installation needs a computer with Node, pnpm, a clone of the repository and a Wrangler login, then `pnpm oc deploy` ([deployment](../../operations/deployment.md)). That suits an operator who will also upgrade and back up from that computer. It is a lot to ask of someone who only wants to try OpenChat in their own Cloudflare account.

Cloudflare's [Deploy to Cloudflare button](https://developers.cloudflare.com/workers/platform/deploy-buttons/) copies a public repository into the person's own GitHub or GitLab account, creates the D1 database, R2 bucket, Queues and Durable Objects named in the repository's Wrangler configuration, writes the new IDs into that file, and then runs the `build` and `deploy` scripts of `package.json` in Workers Builds on every push.

Three things `oc deploy` does have no place in that flow:

1. **It renders the Worker's configuration** into `.openchat/<name>/`. The button reads a configuration committed in the repository. Cloudflare asks that the application be complete within the directory the button points at, dependencies included, which for this monorepo means the repository root.
2. **It generates the signing keys** on the operator's computer and sets them as Worker secrets. The button can only ask the person to type a secret, and nobody can type an Ed25519 key.
3. **It creates the first admin** by writing SQL through Wrangler, and prints a one-time link. With the button there is no terminal to print to, and usually no email provider to send through.

## Decision

- **The repository root carries the button's configuration**: `wrangler.jsonc`, generated from `services/api/wrangler.template.jsonc` by `pnpm oc button-config`, with a placeholder database ID. A test fails if the two drift apart. Local development and `oc deploy` do not read it.
- **The root `deploy` script is `oc button-deploy`.** It applies migrations by binding name, then deploys. It asks Wrangler which secrets the Worker has, and generates `AUTH_SIGNING_KEY` and `RELAY_SIGNING_KEY` only when they are missing, passing them with `wrangler deploy --secrets-file` from a file that exists only for that command. If it cannot tell which secrets exist, it stops, because a replaced key signs everyone out and breaks push. Keys stay Worker secrets, as before. They are never stored in D1.
- **The first admin is created in the browser, once, behind a setup code.** The button asks for one secret, `SETUP_CODE`, which the person makes up. While the `installation` table is empty and that secret is set, `POST /api/v1/setup` takes the code, a company name, and the admin's name, email and password, and creates the same rows as `oc deploy`. `GET /api/v1/setup` tells the dashboard which page to show. The installation's public address is the origin the request came to.
- **Setup can happen only once.** The installation row is inserted only into an empty table, and every other row depends on it, in one batch, so two requests at once cannot both win. Afterwards the route answers 404, whatever the code.
- **Without `SETUP_CODE` the route does not exist.** An installation made by `oc deploy` never has that secret, so nothing changes for it.
- **Guesses are limited** to 10 per address in 15 minutes, and to 30 an hour across all addresses, because a person may choose a short code.
- **The button's configuration points at the project's relay**, which is open to every installation, so that push to the official app works without another step.

## Why a setup code, and not the first visitor

A new `workers.dev` address is not secret for long. If whoever opened it first could create the admin, a stranger could take the installation before its owner did, and the owner might not notice until their own setup failed. The code costs one field in Cloudflare's form and one in ours.

Printing a generated code in the build log was the alternative. It needs no field in Cloudflare's form, but the person must find a build log they have never seen before.

## Consequences

- A second way to deploy now exists, and both must keep working. `oc deploy` remains the documented way for anyone who wants `oc upgrade`, `oc rollback`, `oc backup`, `oc restore`, `oc recover` and `oc health`: those read `.openchat/<name>/state.json`, which a button deployment does not have.
- A button deployment has **no operator token**, so `/health/*` answers 404 until its operator sets `OPERATOR_TOKEN` themselves.
- **Upgrades are a Git push** to the person's copy of the repository, with no version check, no recorded bookmark and no automatic rollback. Migrations being expand/contract ([rule 8](../../../AGENTS.md)) is what makes that safe to run unattended.
- The copy deploys whatever commit the button copied, but reports the version in `package.json`. A release must be tagged for the two to match.
- The global limit on guesses means a flood of wrong codes can delay the real owner's setup. That is chosen over letting the code be guessed.
- `SETUP_CODE` is useless once setup is done, and can be deleted.
- The public API gains two routes that need no sign-in. Both are listed, with reasons, in the isolation test.
- The whole flow through Cloudflare's own button has **not been run yet**: it needs the change on the public default branch. The deploy script and the setup page were run on real Cloudflare from a computer, standing in for the button ([validation](../cloudflare-validation.md#the-deploy-button-2026-11-15)).
