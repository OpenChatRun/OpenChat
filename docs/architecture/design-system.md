# Design system

OpenChat has one look across the dashboard, the website widget, the iPhone app and [openchat.run](https://openchat.run). The colours come from the icon, a blue cube with a navy face. The layouts follow the pattern that customer-messaging products such as Tidio made familiar, so that someone who has used one knows their way around this one.

## The icon

| File | Use |
|---|---|
| [`docs/assets/brand/openchat-mark-512.png`](../assets/brand/openchat-mark-512.png) | The mark on a transparent background, for documents and the README |
| `apps/dashboard/public/brand/` | The mark at 96, 128 and 256 pixels, the favicon, and the home-screen icon |
| The iPhone app's icon and splash | In the private repository with the app. The icon is the mark on a light blue gradient, and the splash background is `#eef3ff` |

The source is a 1254-pixel render. Its edges were cleaned up into a solid mask before any size was made from it. To make new sizes, scale `openchat-mark-512.png` down, never up.

The widget does not show the icon. It sits on a customer's website, which has its own brand.

## Colours

Every pair of text and background in this table meets WCAG AA, 4.5:1, in the theme it belongs to.

| Token | Light | Dark | Use |
|---|---|---|---|
| Primary | `#0a57f5` | `#5b9bff` | Buttons, the agent's own messages, links, selected tabs. White text on the light value is 5.7:1 |
| Primary, pressed | `#0846d1` | | Hover and pressed states |
| Sky | `#18a0fb` | | The light end of the gradient on avatars, from the top of the cube |
| Navy | `#0e1a4f` | `#0a0a0b` | The dashboard's side rail, and the browser's theme colour |
| Background | `#ffffff` | `#121214` | Panels, cards, the widget panel |
| Surface | `#f5f7fc` | `#000000` | The page behind cards, and behind a conversation's messages |
| Soft | `#eef4ff` | `#27272a` | Selected rows, filter pills, a teammate's messages |
| Line | `#dee4f0` | `#27272a` | Borders and dividers |
| Text | `#0b1437` | `#f4f4f5` | Body text |
| Muted text | `#4d5a80` | `#a1a1aa` | Times, labels, hints. 6.3:1 on the light surface |
| Danger | `#b42318` | `#fda29b` | Errors, and erasing |
| Online | `#12b76a` | `#32d583` | The dot on an avatar of someone online |

Dark mode is black and neutral grey, not navy. Blue stays only where it means something: buttons, links, the selected item, and the website's colour in the widget. The dashboard follows the device's setting, unless someone picks Light or Dark in its header, which that browser remembers. The widget and the app always follow the device.

Internal notes stay amber in every surface, so that nobody mistakes one for a reply.

The dashboard replaces Tailwind's `slate` scale with greys tinted toward the navy, swapped for neutral greys in dark mode, and adds a `brand` scale, in [`apps/dashboard/src/styles.css`](../../apps/dashboard/src/styles.css). The widget's values are in [`apps/widget/src/styles.ts`](../../apps/widget/src/styles.ts) and its loader, and the app's in its `src/ui/kit.tsx`, in the private repository. They are copies, not one shared package, because the dashboard is under the AGPL, the widget under Apache-2.0, and the app is not open source. Change all of them together, and this table.

### The widget's colour

A website's own colour, set on the Workspaces page, replaces the primary colour everywhere in its widget. Text on it is black or white, whichever contrasts more. With no colour set, the widget uses the primary blue, `#0a57f5`. A website that saved the old default, `#2563eb`, keeps it.

## Layout

**Dashboard.** A navy rail down the left holds the logo, the workspace's sections, the installation admin's pages, and signing out. Each item is an icon with its name read out and shown on hover. On a phone the rail is a bar along the top. The inbox is one framed surface in three panes: conversations, the open conversation on a tinted background, and the contact and tags.

**Widget.** A round launcher that turns into a close arrow while the panel is open. The panel has a tall header in the website's colour with a curved lower edge, an online dot on its avatar, and a button that minimises it. The team's messages have the sender's initial beside the first of each run, and the message box is one rounded field with round icon buttons to attach and send. On a phone, or any screen up to 640 pixels wide or 500 high, the open panel fills the screen, inside the safe area, over the launcher.

**App.** The same colours, in Tidio's arrangement: grouped white cards on the tinted surface, a segmented control for open, pending and resolved, filter chips with icons, and conversation rows with the time, tags, a priority flag and an unread count. A conversation has the person's avatar and presence in its header, status, priority and assignee as chips, the visitor's avatar beside their messages, and a message box with **Reply** and **Note** tabs and round icon buttons to attach and send. Someone with no installation starts at a three-page welcome, with illustrations, and a link to setting OpenChat up on Cloudflare at openchat.run.

The app's avatars each take one of eight colours, chosen from the person's name so that it never changes: `#0a57f5`, `#4e5ba6`, `#6941c6`, `#0e7090`, `#c11574`, `#b54708`, `#067647` and `#3538cd`. White initials on each meet WCAG AA. Telling people apart at a glance matters more on a phone, where there is no room for a name beside every message. In dark mode, internal notes are a dark amber, `#4a3510` with `#fef3c7` text, rather than the light one.

## Shapes and type

- Corners: 8 pixels on small controls, 12 on cards and fields, 16 on the widget panel. Message bubbles are 18, with 6 on the sender's lower corner, or 4 in the widget.
- Avatars show up to two initials. Someone with no name shows an outline of a person, in the dashboard and the app.
- Type is the system font everywhere except openchat.run, which uses Geist.
- Icons are line drawings on a 24-pixel grid, drawn for OpenChat, in [`apps/dashboard/src/icons.tsx`](../../apps/dashboard/src/icons.tsx). The app uses Apple's SF Symbols instead, which match iOS.
