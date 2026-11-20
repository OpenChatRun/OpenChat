# Administration

For installation admins. The first admin is the person `oc deploy` set up. Admin pages are in the dashboard's side rail, below a line, after the workspace's own sections: **People**, **Workspaces**, **Failed jobs** and **Audit log**. Point at an icon to see its name. On a phone the rail is a bar along the top.

Being an admin lets you change settings, not read conversations. To read a workspace's conversations, add yourself to it on the People page, which the audit log records.

## People

**Add someone.** Enter their name and email, then **Add**. OpenChat emails them a link to choose a password, which lasts seven days. Then add them to a workspace, as an agent or a supervisor. Without a workspace they can sign in but see nothing.

This needs email. Without it, run `pnpm oc recover --env <name> --email <address>` on the computer you deploy from, which prints a reset link to pass on yourself.

**Find someone.** Search by part of a name or email, and use **All**, **Admins** and **Deactivated** to narrow the list. You come first. Click a person to see their workspaces and what you can change. A long list shows 100 at a time, with **Load more** below.

Making someone an admin, and removing your own admin role, ask you to confirm.

For each person you can:

| Action | What it does |
|---|---|
| **Add to workspace**, and change the role | Agent or supervisor, for each workspace. See [roles](README.md#how-it-fits-together) |
| **Remove** from a workspace | Ends their access there. Their messages keep their name. Undo by adding them again |
| **Make admin**, **Remove admin role** | Gives or takes the admin role. Be sparing: every admin has power over every workspace |
| **Deactivate account** | Signs them out everywhere and stops them signing in. Their messages stay, with their name. **Reactivate account** undoes it |

Nobody can delete an account. That keeps the history of who said what. A former colleague's name cannot be erased yet; see [known issues](../known-issues.md).

## Workspaces

Choose a workspace under **Workspace to manage**. Creating one with **Create workspace** does not add you to it.

### Websites

Each website has its own chat button. **Add a website** with a name and its **allowed origins**: the exact addresses of the sites it may appear on, one per line, such as `https://www.company.com`. No paths and no wildcards. The widget refuses to load anywhere else.

Each website's card has the snippet to paste into the site. See [the website widget](widget.md) for that, and for these **Widget** settings:

| Setting | Choices |
|---|---|
| Welcome message | Up to 500 characters, shown as written, in any language |
| Colour | The chat button, the panel's header, and the visitor's messages. Without one, OpenChat's blue, `#0a57f5` |
| Ask for an email | **Never**, **Offer it, after the first message**, or **Before the first message** |
| Widget language | **Automatic**, or one of eleven languages |
| Show agents' names to visitors | Off by default, so visitors see "Support", in their language |
| Check that new visitors are people | Cloudflare Turnstile, when a new visitor first writes. Needs keys set at deploy time |

The widget picks up a change within a minute.

### Retention

**Keep closed conversations** decides how long resolved and archived conversations stay: **Forever**, the default, or 30 days to two years after their last message. Once one is older, it is deleted with its messages and files, within the hour, and cannot be recovered from OpenChat. Contacts left with no conversations go too. Open and pending conversations are never deleted this way. Each run is in the audit log.

Shortening it asks you to confirm, because older conversations start going within the hour. See [privacy and data](privacy.md#how-long-data-is-kept).

### Push notifications

Shows whether the installation is connected to a notification relay, and how many phones have registered. **Disconnect and erase** turns push off for everyone, and asks the relay to erase what it holds about the installation: its address, its workspace names, and an ID for each phone. **Reconnect** turns it back on.

## Follow-up emails

In each workspace, on its **Email** tab, a supervisor can add follow-up rules: send one email when an open conversation has had no messages for a set time, such as 60 minutes. It goes only to visitors who gave an email address and ticked the box to allow it. It has a fixed text, with no message content, and a link to unsubscribe.

**Addresses not to email** lists who will get no more follow-ups, and why: unsubscribed, bounced, marked as spam, or added by hand. You can add an address, and remove those added by hand.

Email has to be set up when OpenChat is deployed; see the [self-hosting guide](../operations/self-hosting.md#optional-email).

## The AI assistant

If your installation was deployed with it, a supervisor finds **Assistant** in the dashboard.

- **Settings**: the name visitors will see, the model, **Answer visitors**, and **Learn from resolved conversations**. The default model is chosen by whoever runs the installation.
- **Sources**: what it answers from, with your help centre's articles and approved learned answers, and nothing else. Add a page of your website, and it reads that page and the pages it links to under the same address, up to 50, and reads them again every week. Or paste a text, such as opening hours or a returns policy. The page's address must be on one of the website's allowed addresses. A page that cannot be read says why: for example, the site's `robots.txt` does not allow it.
- **Help centre**: published articles of your help centre are a source too, as soon as you save the settings, with a link to the article. Drafts never are. Unpublishing or deleting an article takes it out at once; a change is read again within a minute or two.
- **Try it**: ask a question as a visitor would. You see the answer, marked AI, and the passages it came from. If the sources do not answer the question, it says it does not know. Each question counts towards the daily limit.

With **Answer visitors** on, it answers new messages in conversations nobody on your team has:

- Every answer is labelled AI, for the visitor and in the inbox, with the name you chose. The inbox marks those conversations **AI answering**.
- It passes the conversation to your team when the visitor asks for a person, when the sources do not answer, when it is unsure, after 5 answers, at the daily limit, or if the model fails. The visitor is told someone will reply, and your team gets a push notification then, not for each message before.
- It stops for good in a conversation once someone replies, writes a note, or assigns it.

With **Learn from resolved conversations** on, each conversation your team resolves is read once: the visitor's messages and your team's replies, never notes. The assistant writes one general question and answer from it, without names, email addresses, phone numbers or order numbers, and drops it if any are left. It writes nothing when the answer was only about that visitor, such as their order.

What it learns is listed under **Learned answers**. Nothing is used until a supervisor approves it: change the words first if you need to, then **Approve**. **Reject** stops one being used; **Delete** removes it. Reopening a conversation, adding to it and resolving it again lets it learn again, unless you have already approved or rejected what it learned. Once you trust what it learns, **Use learned answers without approval** skips the review for every website in the workspace; the change is recorded in the audit log. Erasing a contact, or retention deleting a conversation, deletes what was learned from it.

The assistant can be wrong, even with good sources. Try the questions your customers ask most before you rely on it. A change to a page shows within a few minutes of reading it again.

## The help centre

**Help centre**, in the side rail, holds articles your visitors can read and search, one help centre for each website. Every member can read it, drafts included, so that they can find an article to send; supervisors change it.

1. Under **Public address**, choose an address, such as `shop`. Your help centre is then at `https://<your installation>/help/shop`. Until you choose one, nothing is public. **Turn off** takes it down; changing it breaks links to the old address.
2. Choose a **Language**, and add **Collections**, the sections of your help centre in that language, if you want them.
3. Under **Articles**, give a title and choose **New article**. Write it in Markdown, with the preview beside it: `#` for a heading, `**bold**`, `_italic_`, `-` or `1.` for lists, `[text](https://…)` for a link, `>` for a quote. HTML is not allowed. Upload images under **Images**, and **Insert** one where the cursor is.
4. **Save** keeps a draft. **Publish** makes it public at once; **Back to draft** takes it down. Publishing, taking down and deleting are recorded in the audit log.
5. **Translate into** makes a copy in another language for you to translate. Visitors are offered the other languages of an article, and a visitor who opens your help centre's address is taken to their browser's language, if you have articles in it, or else English.

**Draft with AI**, if your installation has Workers AI, writes drafts for you. Tick **Read the website**, add links to pages on your website, or choose files: PDF, Word, OpenDocument, HTML, Markdown or text. Then choose **Draft articles**. It writes in the language chosen at the top of the page, whatever the language of the material. It plans up to 20 articles and writes them one by one; they appear as drafts marked **Drafted by AI**, with the pages and files each came from. Check every fact before you publish: the label goes once you change the words. Only your own website's pages can be read, files are deleted when it finishes, and a workspace can start 5 runs a day. Upload your company's own material only, never customer data.

**In the widget.** Once a website has a published article, its chat widget gains a **Help** tab, where visitors search and read articles in their language without leaving the page. **Still need help?** takes them to the chat, and the conversation shows which article they came from.

Visitors search titles, summaries and text. Search ignores capitals and accents, and finds Chinese, Japanese and Korean words without spaces. **Ask search engines not to list it** adds `noindex` and removes the sitemap. A website can have 1,000 articles.

## Automatic translation

If your installation has Workers AI, a supervisor can turn on **Automatic translation**, at the top of the **Assistant** page. Each visitor's message is then translated into the language each team member uses the dashboard in, and shown with **Translated from …** and **Show original**. A member whose language was not covered can choose **Translate**. Replies written in the dashboard are translated into the visitor's language with the assistant's text model, Llama 3.3 unless your installation chose another, and labelled for the visitor. Internal notes are never translated.

Every visitor message in the workspace is then sent to Workers AI, so check that your privacy notice covers it. **M2M100**, the default model, only translates, so a visitor cannot steer it; a text model translates chat better, but a visitor could try to steer what it writes, which only your team sees. Turning it on or off, or changing the model, is recorded in the audit log. A workspace can translate 200,000 characters a day by default; after that, members see the originals until the next day (UTC).

## Failed jobs

Background work, such as sending a push notification or an email, is retried several times. If it still fails, it is listed here, by kind, with the time and the number of attempts. Fix the cause, for example the email settings, and then **Replay**, or **Dismiss** a job you no longer need. Work a job already finished is not repeated. Some jobs cannot be replayed, because the time they had to run by has passed. Failed jobs are kept for 90 days.

## Audit log

What admins did, and what the system did on their behalf: people and roles, workspaces and websites, someone adding themselves to a workspace, contacts exported or erased, replays and retention runs. Newest first, for **Everything** or one workspace. It names your colleagues, but never a visitor, and never holds message content. Only admins can read it. Retention does not delete it.

## Keeping the installation healthy

Upgrades, backups, health checks and alerts are run from the computer you deploy from, by whoever operates the installation. See:

- [Monitoring](../operations/monitoring.md): `pnpm oc health`, and what to alert on.
- [Backup and restore](../operations/backup-and-restore.md): `pnpm oc backup` and `pnpm oc restore`.
- [Upgrades](../operations/self-hosting.md#7-keep-it-up-to-date): `pnpm oc upgrade`, and `pnpm oc rollback`.
