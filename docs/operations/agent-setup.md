# Set up with an AI agent

A coding agent, such as Claude Code, Codex or Cursor, can install OpenChat for you. It runs the same commands as the [self-hosting guide](self-hosting.md), and stops where only you can act. It takes about 15 minutes, and a few clicks from you.

## For you: what to do

1. Have a Cloudflare account on the **Workers Paid** plan, and Node 24 and Git on your computer.
2. Open your agent in an empty directory, or in your website's code if you want it to add the chat button there too.
3. Paste this, with your own details:

```text
Set up OpenChat for me. Clone https://github.com/OrangoLabsLtd/OpenChat.git
and follow docs/operations/agent-setup.md in it, step by step.

My email: you@company.com
Workspace name: Support
My website: https://www.company.com
AI assistant: yes
```

Leave out **My website** if you only want to try the inbox. Say **AI assistant: no** if you do not want Workers AI to answer visitors.

The agent will ask you to do four things, which it cannot do for you: confirm two settings in the Cloudflare dashboard, approve the Cloudflare login in your browser, set your password, and add your website in the OpenChat dashboard.

## For the agent: the steps

You are installing OpenChat on the person's own Cloudflare account. Follow these steps in order. Each says what you should see. If you see something else, stop, and read [When something goes wrong](self-hosting.md#when-something-goes-wrong) before you try anything.

**Rules**

- Run every `pnpm` command from the root of the clone.
- Change no code. `oc deploy` reminds the operator about the source offer when the checkout differs from the release, and a changed installation is theirs to maintain.
- Use the `pnpm oc` commands only. Do not create, change or delete Cloudflare resources with `wrangler` yourself, and never delete a resource to get past an error.
- A deploy that stops part way is safe to run again with the same command. It resumes, and creates nothing twice.
- The password link is a secret. Show it to the person once. Do not open it, and do not write it to a file, a commit or a log.
- Do not ask for the person's password, and do not sign in as them.
- Keep the `.openchat/` directory, and never commit it to a public repository.

**1. Check the tools.** `node --version` must print `v24`, and `git --version` must work. If Node is missing or older, ask the person to install Node 24, or run `nvm install 24` if `nvm` is there.

**2. Get the code.**

```bash
git clone https://github.com/OrangoLabsLtd/OpenChat.git openchat
cd openchat
git checkout $(git describe --tags --abbrev=0)
corepack enable
pnpm install --frozen-lockfile
```

You should see `pnpm install` finish with `Done`. If `corepack` is not found, run `npm install -g corepack` first.

**3. Ask the person to prepare Cloudflare.** Only they can do this, in the [Cloudflare dashboard](https://dash.cloudflare.com). Give them this list, and wait for them to say it is done:

1. **Workers & Pages > Plans:** choose Workers Paid.
2. **Storage & databases > R2 > Overview:** complete the one-time sign-up for R2.
3. **Workers & Pages:** choose a `workers.dev` subdomain, if asked.

**4. Sign in to Cloudflare.**

```bash
pnpm --filter @openchat/api exec wrangler whoami
```

If it shows an account, go on. If not, run `pnpm --filter @openchat/api exec wrangler login`, which opens the person's browser for them to allow access. Where there is no browser, such as on a server, ask them for an API token in the `CLOUDFLARE_API_TOKEN` environment variable instead, and do not print it.

**5. Check before creating anything.**

```bash
pnpm oc preflight
```

It only reads. Every line must be `ok`, `confirm` or `note`. On a `FAIL`, do what its line says, and run it again. If the login reaches several accounts, ask the person which one, and set `CLOUDFLARE_ACCOUNT_ID` to it for every later command.

**6. Deploy.** Use `production` as the name unless the person gave another, or `.openchat/production` already exists. If it exists, this account already has an installation: ask whether they want to upgrade it, with [step 7 of the self-hosting guide](self-hosting.md#7-keep-it-up-to-date), and do not deploy over it.

```bash
pnpm oc deploy --env production --owner-email <their email> --workspace "<workspace name>" \
  --relay-url https://openchat-relay.orangolabs.com --relay-id managed \
  --relay-bundle-ids com.orangolabs.openchat
```

Add `--assistant` for the AI assistant. The three `--relay` options let the official iPhone and Android apps receive notifications; using the relay means accepting its [terms](../legal/relay-terms.md), so tell the person, and leave the options out if they do not want the apps.

It takes a few minutes. At the end you should see `Deployed`, the installation's address, and a link to set the owner's password.

**7. Hand over the password link.** Give the person the address and the link, and say that the link works once, for one hour. Wait for them to say they have set a password and can see the inbox. If the hour passed, `pnpm oc recover --env production --email <their email>` prints a new link.

**8. Check that it is healthy.**

```bash
pnpm oc health --env production
```

Every check should pass.

**9. Add the chat button, if they gave a website.** Ask the person to do this in the OpenChat dashboard, and to send you the code:

1. Open **Websites**, and choose **Add website**.
2. Enter a name, and the site's address under **Allowed origins**, such as `https://www.company.com`, with no path.
3. Open the website's **Install** tab, and choose **Copy code**.

The code is one `<script>` line. If the website's code is in front of you, add that line just before `</body>` in the layout every page shares, and show the person the change. Do not publish or deploy their website unless they ask. If the site has a content security policy, it must allow the installation's address for scripts and connections. If you cannot reach the website's code, tell the person where the line goes.

**10. Report.** Tell the person, in a few lines:

- the installation's address, and that they are its admin;
- what was turned on: the AI assistant, the relay for the apps;
- where the chat button's line was added, and that it shows once their site is published;
- that `.openchat/` must be kept and backed up, because upgrades need it;
- what is left for them: adding their team under **People**, [email](self-hosting.md#optional-email), [backups](backup-and-restore.md), and, for the AI assistant, giving it something to answer from under **Assistant > Knowledge**;
- how to upgrade later: [step 7 of the self-hosting guide](self-hosting.md#7-keep-it-up-to-date).

Say plainly what you did not do or could not check.
