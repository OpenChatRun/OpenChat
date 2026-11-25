# Administration

For installation admins. The first admin is the person `oc deploy` set up. Admin pages are in the dashboard's side rail, below a line, after the workspace's own sections: **People**, **Workspaces**, **Failed jobs** and **Audit log**. Point at an icon to see its name. On a phone the rail is a bar along the top.

Being an admin lets you change settings, not read conversations. To read a workspace's conversations, add yourself to it on the People page, which the audit log records.

## People

**People** is every account on the installation, across all workspaces, and only installation admins see it. **Members**, in each workspace's own sections, is the people in that workspace with their roles, and every member sees it. You add someone under People, then give them a role in a workspace; they then appear under that workspace's Members.

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

Choose a workspace under **Workspace to manage**. Creating one with **Create workspace** does not add you to it. **General** holds its name and how long it keeps conversations, and **Websites** its websites. Push notifications, for the whole installation, are at the foot of the page.

### Websites

Each website has its own chat button. Websites are on a workspace's **Websites** tab here, and, for a workspace you belong to, on its own **Websites** page in the side rail, where members who are not admins can copy the code and nothing more. **Add website** with a name and its **allowed origins**: the exact addresses of the sites it may appear on, one per line, such as `https://www.company.com`. No paths and no wildcards. The widget refuses to load anywhere else.

Choose **Settings** beside a website to open it. **Install** has the code to paste into the site, with **Copy code**; **Appearance** the colour, welcome message and language, beside a sketch of the widget; **Chat** what it asks of visitors; **Opening hours**; and **Details** the name and allowed origins. **Save changes** saves every tab at once. See [the website widget](widget.md) for installing, and for these settings:

| Setting | Choices |
|---|---|
| Welcome message | Up to 500 characters, shown as written, in any language |
| Colour | The chat button, the panel's header, and the visitor's messages. Without one, OpenChat's blue, `#0a57f5` |
| Ask for an email | **Never**, **Offer it, after the first message**, or **Before the first message** |
| Widget language | **Automatic**, or one of eleven languages |
| Show agents' names to visitors | Off by default, so visitors see "Support", in their language |
| Ask visitors to rate a resolved conversation | On by default. The widget asks for a thumbs up or down, and a comment if they wish |
| Opening hours | Off by default. A time zone, and for each day of the week either closed or one period, such as 09:00 to 17:00. See below |
| Check that new visitors are people | Cloudflare Turnstile, when a new visitor first writes. Needs keys set at deploy time |

The widget picks up a change within a minute.

**Opening hours.** Without them, the widget says "We are online" whenever a member who is not away has the dashboard or the app open. With them, it does so only inside the hours. Outside them it says the team is away, whoever is connected, and when it is back: "We are back at 9:00 AM" today, or "We are back Monday at 9:00 AM", on the visitor's own clock and in the widget's language. Visitors can still write, messages and notifications arrive as always, and the AI assistant still answers if it is on. To stay open until midnight, set the closing time to 00:00. Each day has one period, and a period cannot run past midnight.

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

If your installation was deployed with it, a supervisor finds **Assistant** in the dashboard. The page has five tabs: **Overview**, **Knowledge**, **Try it**, **Settings** and **Translation**.

- **Overview**: whether it answers visitors, with **Turn on** and **Turn off**, how many sources, help articles and learned answers it has, and, for the last 30 days across the workspace, how many conversations it answered and how many of those no person answered.

- **Settings**: the name visitors will see, **How it should write**, the **Handover message**, and **Learn from resolved conversations**. The model is chosen by whoever runs the installation, not in the dashboard.
  - **How it should write** is a few lines about its tone, up to 500 characters, such as "Be formal. Say 'we'." It changes how the assistant writes, never what it answers from: it still answers only from your knowledge, and still passes a visitor to your team when it cannot.
  - **Handover message** is what a visitor reads when the assistant passes them to your team, up to 300 characters. Left empty, visitors read the standard message in their own language. A message of your own is shown as you wrote it, to every visitor, and is not translated.
- **Knowledge**, under **Sources**: what it answers from, with your help centre's articles and approved learned answers, and nothing else. Add a page of your website, and it reads that page and the pages it links to under the same address, up to 50, and reads them again every week. Or paste a text, such as opening hours or a returns policy. The page's address must be on one of the website's allowed addresses. A page that cannot be read says why: for example, the site's `robots.txt` does not allow it.
- **Help centre**: published articles of your help centre are a source too, as soon as you save the settings, with a link to the article. Drafts never are. Unpublishing or deleting an article takes it out at once; a change is read again within a minute or two.
- **Try it**: a conversation with the assistant, as a visitor would have it. Write a question, and then follow-up questions. Under each answer, **From these sources** shows the passages it came from. Where it would pass a visitor to your team, you see the handover message and the reason, and the conversation ends there, as the assistant's part does for a visitor: choose **Start again**. No visitor sees any of it, nothing is saved, and each question counts towards the daily limit.

With **Answer visitors** on, it answers new messages in conversations nobody on your team has:

- Every answer is labelled AI, for the visitor and in the inbox, with the name you chose. The inbox marks those conversations **AI answering**.
- It passes the conversation to your team when the visitor asks for a person, when the sources do not answer, when it is unsure, after 5 answers, at the daily limit, or if the model fails. The visitor is told someone will reply, and your team gets a push notification then, not for each message before.
- It stops for good in a conversation once someone replies, writes a note, or assigns it.

With **Learn from resolved conversations** on, each conversation your team resolves is read once: the visitor's messages and your team's replies, never notes. The assistant writes one general question and answer from it, without names, email addresses, phone numbers or order numbers, and drops it if any are left. It writes nothing when the answer was only about that visitor, such as their order.

What it learns is listed under **Learned answers**. Nothing is used until a supervisor approves it: change the words first if you need to, then **Approve**. **Reject** stops one being used; **Delete** removes it. Reopening a conversation, adding to it and resolving it again lets it learn again, unless you have already approved or rejected what it learned. Once you trust what it learns, **Use learned answers without approval** skips the review for every website in the workspace; the change is recorded in the audit log. Erasing a contact, or retention deleting a conversation, deletes what was learned from it.

**Unanswered questions**, on the **Knowledge** tab, lists what the assistant passed to your team because it had no answer: the visitor's message, the day, and whether it had nothing to answer from or was not sure. It is the quickest way to see what your sources are missing. **Add an answer** to write one: reword the question so that it is general and names nobody, write the answer, and **Save answer**. It is saved under **Learned answers**, already approved, and the assistant uses it within a minute or two. **Open conversation** shows where it was asked, and **Dismiss** takes a question off the list. The number on the **Knowledge** tab counts these and the learned answers waiting for review. A conversation has one learned answer, so if it already has one you are told to change that one instead. A question goes when its conversation does, by erasing the contact or by retention.

The assistant can be wrong, even with good sources. Try the questions your customers ask most before you rely on it. A change to a page shows within a few minutes of reading it again.

## The help centre

**Help centre**, in the side rail, holds articles your visitors can read and search, one help centre for each website. Every member can read it, drafts included, so that they can find an article to send; supervisors change it.

The page has four tabs: **Articles**, **Collections**, **Images** and **Settings**. Until the help centre has a public address, a line at the top says it is off.

1. On **Settings**, under **Public address**, choose an address, such as `shop`. Your help centre is then at `https://<your installation>/help/shop`. Until you choose one, nothing is public. **Turn off** takes it down; changing it breaks links to the old address.
2. Choose a **Language** at the top, and on **Collections** add collections, the sections of your help centre in that language, if you want them.
3. Under **Articles**, give a title and choose **New article**. Write it with the preview beside it. The buttons above the text add a heading, bold, italic, a bulleted or numbered list, a quote, a link or code to what you have selected, and take it away again; **Ctrl+B**, **Ctrl+I** and **Ctrl+K** (⌘ on a Mac) do bold, italic and a link. What they write is Markdown, which you can also type: `#` for a heading, `**bold**`, `_italic_`, `-` or `1.` for lists, `[text](https://…)` for a link, `>` for a quote. HTML is not allowed. Upload images under **Images**, and **Insert** one where the cursor is.
4. **Save** keeps a draft. **Publish** makes it public at once; **Back to draft** takes it down. Publishing, taking down and deleting are recorded in the audit log.
5. **Translate into** makes a copy in another language for you to translate. Visitors are offered the other languages of an article, and a visitor who opens your help centre's address is taken to their browser's language, if you have articles in it, or else English.

To find an article, type words of its title in **Search articles** above the list, or choose **Published** or **Draft** beside it. The list shows one language at a time, chosen at the top of the page.

**Views and "Was this helpful?".** Under each published article, on the help centre and in the widget, readers are asked whether it was helpful, with **Yes** and **No**. The list shows how often each article was opened and how many readers found it helpful, and **Order** puts the most viewed, or the least helpful, first. These are counts and nothing else:

- A view is counted each time an article is opened, so it is not a number of people. Search engines and other known crawlers are left out.
- One answer is counted for each reader and article in a day. A second answer is thanked and not counted.
- Nothing about the reader is kept with either. The counts stay through edits, and go when the article is deleted.

**Draft with AI**, if your installation has Workers AI, writes drafts for you. Tick **Read the website**, add links to pages on your website, or choose files: PDF, Word, OpenDocument, HTML, Markdown or text. Then choose **Draft articles**. It writes in the language chosen at the top of the page, whatever the language of the material. It plans up to 20 articles and writes them one by one; they appear as drafts marked **Drafted by AI**, with the pages and files each came from. Check every fact before you publish: the label goes once you change the words. Only your own website's pages can be read, files are deleted when it finishes, and a workspace can start 5 runs a day. Upload your company's own material only, never customer data.

**In the widget.** Once a website has a published article, its chat widget gains a **Help** tab, where visitors search and read articles in their language without leaving the page. **Still need help?** takes them to the chat, and the conversation shows which article they came from.

Visitors search titles, summaries and text. Search ignores capitals and accents, and finds Chinese, Japanese and Korean words without spaces. **Ask search engines not to list it** adds `noindex` and removes the sitemap. A website can have 1,000 articles.

## Automatic translation

If your installation has Workers AI, a supervisor can turn on **Automatic translation**, on the **Translation** tab of the **Assistant** page. Each visitor's message is then translated into the language each team member uses the dashboard in, and shown with **Translated from …** and **Show original**. A member whose language was not covered can choose **Translate**. Replies written in the dashboard are translated into the visitor's language with the assistant's text model, Llama 3.3 unless your installation chose another, and labelled for the visitor. Internal notes are never translated.

Every visitor message in the workspace is then sent to Workers AI, so check that your privacy notice covers it. The model is chosen by whoever runs the installation, not in the dashboard. **M2M100**, the default, only translates, so a visitor cannot steer it. Turning translation on or off is recorded in the audit log. A workspace can translate 200,000 characters a day by default; after that, members see the originals until the next day (UTC).

## Failed jobs

Background work, such as sending a push notification or an email, is retried several times. If it still fails, it is listed here, by kind, with the time and the number of attempts. Fix the cause, for example the email settings, and then **Replay**, or **Dismiss** a job you no longer need. Work a job already finished is not repeated. Some jobs cannot be replayed, because the time they had to run by has passed. Failed jobs are kept for 90 days.

## Audit log

What admins did, and what the system did on their behalf: people and roles, workspaces and websites, someone adding themselves to a workspace, contacts exported or erased, replays and retention runs. Newest first, for **Everything** or one workspace. It names your colleagues, but never a visitor, and never holds message content. Only admins can read it. Retention does not delete it.

## Keeping the installation healthy

Upgrades, backups, health checks and alerts are run from the computer you deploy from, by whoever operates the installation. See:

- [Monitoring](../operations/monitoring.md): `pnpm oc health`, and what to alert on.
- [Backup and restore](../operations/backup-and-restore.md): `pnpm oc backup` and `pnpm oc restore`.
- [Upgrades](../operations/self-hosting.md#7-keep-it-up-to-date): `pnpm oc upgrade`, and `pnpm oc rollback`.
