# Deploy with one click

The quickest way to get your own OpenChat. Cloudflare copies this repository into your GitHub or GitLab account, creates everything in your Cloudflare account, and deploys it. You need no terminal.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/OpenChatRun/OpenChat)

> **Tried through Cloudflare's own button on 2026-11-17**, from a fresh account to signing in as the admin. If a step here does not match what you see, please [open an issue](https://github.com/OpenChatRun/OpenChat/issues), and use the [self-hosting guide](self-hosting.md) meanwhile.

If you want to upgrade, roll back, back up and restore from the command line, use the [self-hosting guide](self-hosting.md) instead. The two ways make the same installation, but the `oc` commands only know one they made themselves ([what you do not get](#what-you-do-not-get)).

## Before you start

| You need | Why |
|---|---|
| A Cloudflare account on **Workers Paid** | Password hashing does not fit in the Free plan's CPU limit, so sign-in fails there ([ADR-0009](../architecture/decisions/0009-paid-plan-and-password-hashing.md)) |
| **R2** added to the account | Storage & databases, R2, then complete the checkout once |
| A `workers.dev` subdomain | Workers & Pages asks you to choose one the first time |
| A GitHub or GitLab account | Cloudflare puts your copy of the code there |

## Steps

1. Press the button, choose your Cloudflare account if you have more than one, and connect your Git account when Cloudflare asks. Connecting can drop you on a different page; if it does, press the button again, and the account is remembered.
2. Choose the Git account for your copy, and tick **Create private Git repository** unless you want the copy public. Cloudflare lists what it will create: a database, a file bucket, and six queues. The names can stay as they are. The project name names the Worker, and does not rename the others, which all start with `oc-chat`.
3. **Choose a setup code** in the field named `SETUP_CODE`. Make something up, such as three random words. You will type it once more, in step 5. Leave the other values alone.
4. Press **Deploy**, and wait for the build. It took under three minutes in the trial: it builds the dashboard and widget, applies the database migrations, creates the signing keys, and deploys. Until it finishes, the address answers `error code: 1042`.
5. Open your Worker's address. The page asks for the setup code, your company's name, and your own name, email and password. This page works once. After it, you are signed in as the installation's admin.

Then follow the [user guide](../guide/README.md) to add your website and the widget.

## What the setup code is for

Your new address is public from the moment it exists. Without a code, whoever opened it first could make themselves the admin. The code proves the installation is yours. It is a secret of your Worker, and after setup it does nothing. You can delete it under the Worker's **Settings**, **Variables and Secrets**.

If the page says the installation is not set up yet, the Worker has no `SETUP_CODE`. Add one in the same place, as a secret, and reload.

## Email

Without an email provider, new colleagues cannot receive the link that lets them choose a password, and a forgotten password cannot be reset by email. Set one up before you invite anyone.

**Resend** needs no change to the code. Add these three under **Settings**, **Variables and Secrets**, each as a secret:

| Name | Value |
|---|---|
| `EMAIL_PROVIDER` | `resend` |
| `RESEND_API_KEY` | Your Resend API key |
| `SYSTEM_EMAIL_FROM` | An address on a domain you verified with Resend |

**Cloudflare Email Sending** needs a binding, which lives in the code. In your copy of the repository, add this to `wrangler.jsonc`, with your own address, and push. Then add `EMAIL_PROVIDER` = `cloudflare` and `SYSTEM_EMAIL_FROM` as secrets.

```jsonc
"send_email": [{ "name": "EMAIL", "allowed_sender_addresses": ["no-reply@example.com"] }]
```

## Your own domain

Add a custom domain to the Worker in Cloudflare's dashboard. The installation remembers the address you set it up at, and puts that address in the links it emails. Changing it afterwards is not built for a one-click deployment, so add the domain **before** step 5 if you want one, and do step 5 at that address.

## Push notifications

Your installation is already pointed at the OpenChat project's notification relay, so the official iPhone app can receive notifications. The relay carries only notifications encrypted for each phone ([ADR-0017](../architecture/decisions/0017-encrypted-notifications.md)). To do without it, remove the three `RELAY_` values from `wrangler.jsonc` in your copy, and push.

## Upgrading

Your copy of the repository does not follow this one by itself. To upgrade, bring a newer release into it and push. Cloudflare then builds and deploys it, applying new migrations first.

```sh
git remote add upstream https://github.com/OpenChatRun/OpenChat.git
git fetch upstream --tags
git merge v0.3.0        # the release you want
git push
```

Keep your own `wrangler.jsonc` when Git reports a conflict in it: it holds your database's ID.

The dashboard tells installation admins when a newer release exists. To turn that off, set `UPDATE_CHECK` to `off` in the `vars` of your `wrangler.jsonc` ([the notice](deployment.md#the-notice-of-a-newer-release)).

If an upgrade goes wrong, roll the Worker back under **Deployments** in Cloudflare's dashboard. The database keeps its new schema, which the previous release can use.

If you change the code, the AGPL asks that you offer your users the source you run. Set `SOURCE_URL` in the `vars` of your `wrangler.jsonc` to where your copy is published ([licensing](licensing.md#the-source-offer)).

## What you do not get

| Missing | Instead |
|---|---|
| `oc upgrade`, `oc rollback` | A Git push, and Cloudflare's **Deployments** page, as above |
| `oc backup`, `oc restore` | D1 Time Travel in Cloudflare's dashboard, or Wrangler directly ([backup and restore](backup-and-restore.md)) |
| `oc recover`, the reset link without email | Nothing yet. Set up [email](#email), and keep a second admin |
| `oc health` and `/health/*` | Add a long random `OPERATOR_TOKEN` secret yourself, then follow [monitoring](monitoring.md) |
| Limits and `security.txt` set by flags | Add the variables to `vars` in `wrangler.jsonc` ([abuse limits](abuse-limits.md)) |

## Removing it

Delete the Worker's queue consumers first, or Cloudflare refuses to delete the Worker. With Wrangler, for each of the six queues, then the rest:

```sh
npx wrangler queues consumer remove oc-chat-jobs <worker name>   # and the other five
npx wrangler delete --name <worker name>
npx wrangler queues delete oc-chat-jobs                          # and the other five
npx wrangler r2 bucket delete oc-chat-attachments                # once it is empty
npx wrangler d1 delete oc-chat
```

Then delete your copy of the repository in GitHub or GitLab.

## How it works

The button reads three things at the root of the repository: `wrangler.jsonc` for what to create, `.dev.vars.example` for the secret to ask for, and the `build` and `deploy` scripts of `package.json`. `deploy` runs `pnpm oc button-deploy`, which is in `tooling/cli/src/button.ts`. The decision and its reasons are in [ADR-0020](../architecture/decisions/0020-deploy-button-and-browser-setup.md).

`wrangler.jsonc` is generated. After changing `services/api/wrangler.template.jsonc`, or the version in `package.json`, run `pnpm oc button-config`. A test fails until you do.
