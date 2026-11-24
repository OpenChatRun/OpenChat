# The inbox

For agents and supervisors. The inbox is the same on the web dashboard and in the iPhone app, though the app has fewer settings.

In the dashboard, the navy rail on the left holds the workspace's sections, **Inbox**, **Contacts**, **Analytics**, **Websites**, **Members** and **Email**, and **Sign out** at the bottom. Point at an icon to see its name. The inbox has three columns: the list of conversations, the open conversation, and the visitor's contact details and tags.

## Signing in

Open your installation's address, such as `https://chat.company.com`, and sign in with your email address and password. Your first password comes from the link your administrator's account email sent you. It lasts seven days. If it has run out, ask for a new one.

Forgot your password? Choose **Forgot your password?** and enter your address. If the account exists, a link arrives by email. Using it signs you out everywhere else.

## Finding conversations

The list on the left shows one status at a time, newest activity first. Choose the status, and whose conversations, at the top of the list:

| Status | Means |
|---|---|
| open | Waiting for the team. New conversations start here |
| pending | Waiting for the visitor, or for something outside the chat |
| resolved | Finished |
| archived | Put away |

A message from the visitor puts a conversation back to **open**, whatever its status, so that someone sees it.

**Assigned to** filters by **Everyone**, **Me** or **Unassigned**. High and urgent conversations are marked in the list.

Each conversation shows the start of its newest message under the contact's name, marked when it is an internal note or from the AI assistant.

To find someone, type part of their name or email address in the box above the list. A search looks in every status and at everyone's conversations, and shows each one's status. It does not look inside messages. Clear the box to return to the list.

New messages appear as they arrive. If live updates are blocked, for example by a company network, the dashboard says so and checks every 30 seconds instead. Sending still works.

If you belong to more than one workspace, choose it at the top right of the page. Each workspace's conversations stay in that workspace.

## Answering

Open a conversation to see its messages, and the visitor's contact card beside them.

- **Reply** goes to the visitor. **Enter** sends, and **Shift+Enter** starts a new line.
- **Internal note** is seen only by your team. It never reaches the visitor, in the widget or in an email.
- **Attach a file** to send up to 25 MB: images (PNG, JPEG, GIF, WebP), PDF, ZIP, Word, Excel, PowerPoint, plain text or CSV. Other types, including HTML and SVG, are refused.

**Saved replies.** For answers you give often, choose **Saved replies** under the reply box, or type `/` in an empty box. Search by title or text, and click one, or press **Enter** for the first, to put it in the box. You can still edit it before sending. A supervisor adds, edits and deletes saved replies in the same place; a workspace can hold 200.

If your workspace translates visitors' messages, a message in another language shows its translation into your dashboard language, labelled **Translated from …**, with **Show original**. A new message shows **Translating…** for a second or two. If there is no translation, choose **Translate**.

Your replies to that visitor are then translated into their language before they are sent, as the line above the reply box says. You see your own words, labelled **Sent translated**, with **Show what was sent**; the visitor sees the translation, labelled **Translated automatically**, and can see your words. If it cannot be translated, nothing is sent: choose **Try again**, or **Send untranslated** to send your words as you wrote them. Internal notes are never translated. The iPhone and Android apps do the same, in your phone's language.

Under the visitor's name is the **visitor's language**, as their widget or browser gave it. A supervisor can correct it there. The dashboard keeps the language you choose for it in your account too, so a new device starts in it.

At the top of the conversation you can change its **status**, its **priority** (low, normal, high or urgent) and who it is **assigned** to. An agent can assign conversations to themselves, and reassign only their own. A supervisor can assign anyone's.

If someone else changes a conversation at the same moment as you, your change is refused with "This conversation just changed". Check what changed, and try again.

**Away.** On the **Members** page, tick **Away** beside your own name when you have the dashboard open but cannot answer. While you are away you do not make the widget tell visitors the team is online; within half a minute it follows the change. Notifications still reach you. Untick it when you are back. If the website has [opening hours](admin.md), the widget says the team is away outside them whether you are away or not.

Whether the visitor is online now is shown on the conversation, with the page of your website they are viewing, or last viewed. It follows them within about 20 seconds. The address is shown without anything after `?` or `#`. The visitor sees when the team is typing a reply, never a note.

When you resolve a conversation, the widget asks the visitor to rate it good or bad, unless the website has that turned off. Their answer, and a comment if they left one, shows under their name, within about 20 seconds while they are online. A visitor's rating does not reopen the conversation or notify anyone.

## Contacts and tags

The contact card shows what the visitor told you: a name, and an email address if the website asked for one. **The address is not verified.** Anyone can type any address, so do not share account details because of it. You can correct the name and address and **Save contact**.

Tags help find and group conversations. Type a tag to add it to the conversation, or choose one the workspace already uses.

**The Contacts page.** **Contacts**, in the rail, lists everyone who has written to the workspace, the most recently active first, with their email address if they gave one, how many conversations they have, and when the latest one last changed. Search by name or email address. Choose someone to open their latest conversation, with their contact card beside it. A visitor who opened the widget and never wrote is not listed.

An installation admin who is a member of the workspace also sees **Export data** and **Erase contact** on the card. See [privacy and data](privacy.md#a-persons-request-about-their-data).

## Analytics

For supervisors. **Analytics**, in the rail, shows what happened to the conversations started in the last 7, 30 or 90 days, where a day is a day on your own clock:

| Number | Means |
|---|---|
| Conversations | Conversations started in the period |
| Answered by the team | Those a person has answered. The AI assistant's answers and internal notes do not count |
| Median first reply | From the start of a conversation to a person's first answer: half were answered sooner, half later. A dash when none was answered |
| Resolved | Those that are resolved or archived now |
| Rated good by visitors | Of those a visitor rated, the share rated good, with the counts. Shown only when there are ratings |
| AI assistant answered | Those the assistant wrote in, and how many of them no person has answered. Shown only when there are any |

Below is a bar for each day's new conversations. Point at a bar, or move to it with the keyboard, for its day and count, or choose **Show as a table**. **Replies by member** lists each member's public replies in these conversations, and in how many conversations they replied.

Every number is about the conversations started in the period, so a reply today in last month's conversation counts under 30 days and not under 7.

## On iPhone

The official OpenChat iPhone app does the same work: the inbox, replies and notes, files and photos, status and assignment, the contact card and tags.

**The official app is not on the App Store yet.** Until it is, your team uses the dashboard. A company that builds its own branded app distributes it itself.

1. Open the app, and under **Connect to your team** enter your installation's address. Your administrator can give it to you. It must be `https://`.
2. Sign in with the same email and password as the dashboard.

Photos have their location and other details removed before they are sent. Documents are sent as they are.

**About and licences**, under Settings, shows the app's version, the open-source licences it includes, and where to get the source of the app and of your installation.

**Notifications.** Under **Settings**, choose which to receive: **New conversations**, **New messages**, or only those **Assigned to you**, for each workspace. They need your installation to be connected to a notification relay, and iOS to allow notifications for the app. Notifications are end-to-end encrypted to your phone: the relay that carries them cannot read them. If push is not available, the app says why, and messages still arrive while it is open.

Signing out of the app removes that installation's data from the phone.
