# OpenChat user guide

OpenChat is customer chat that a company runs in its own Cloudflare account. Visitors write from a chat button on the company's website. The team answers from a web dashboard, or from an iPhone app, and can send a follow-up email to visitors who go quiet.

This guide is for the people who use it. To set up an installation, see the [self-hosting guide](../operations/self-hosting.md). To work on OpenChat itself, see [the documentation index](../README.md).

## Which page you need

| You are | Read |
|---|---|
| Answering customers | [The inbox](inbox.md), on the web and on iPhone |
| Running the installation for your company | [Administration](admin.md) |
| Putting the chat button on a website or in a mobile app | [The website widget](widget.md) |
| Writing help articles for visitors | [Administration: the help centre](admin.md#the-help-centre) |
| Responsible for privacy, or answering a person's request about their data | [Privacy and data](privacy.md) |

Before relying on OpenChat, read the [known issues](../known-issues.md).

## How it fits together

- **An installation** is one company's OpenChat: one address, such as `https://chat.company.com`, one database, and one set of accounts. Nothing is shared with other companies.
- **A workspace** is a team or brand inside it, with its own conversations, contacts and websites. Members of one workspace cannot see another's.
- **A website** belongs to a workspace, and has its own chat button and settings.
- **People** have one account for the installation, and a role in each workspace they belong to:

| Role | Can |
|---|---|
| Agent | Read and answer conversations, write internal notes, tag, and assign conversations to themselves. Reassign only their own |
| Supervisor | All of that, and assign anyone's conversations, set up follow-up emails, the AI assistant, and the help centre |
| Installation admin | Add and remove people, create workspaces, add websites and change their settings, set retention, and read the audit log. An account setting, not a workspace role: an admin sees no conversations until they add themselves to the workspace, which the audit log records |

Each page of the web dashboard has its own address, such as `/websites`, `/admin/workspaces` or `/inbox/` followed by a conversation, so a refresh, a bookmark or the browser's back button keeps your place. The Help centre page is at `/help-centre`, because `/help/` is where visitors read the published articles. The workspace is not part of the address: the dashboard opens the one you chose last in that browser.

There is no sign-up page and there are no invitations. An installation admin creates each account, and OpenChat emails that person a link to choose a password.
