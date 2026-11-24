# The website widget

For whoever looks after the website. The widget is the chat button visitors use. An installation admin creates the website in OpenChat and gives you its snippet; see [administration](admin.md#websites).

## Adding it to a site

Paste the snippet just before `</body>`, on every page that should have the button:

```html
<script src="https://chat.company.com/widget/widget.js" data-website-key="wk_..." async></script>
```

The page's address must be in the website's **allowed origins** in OpenChat, exactly, such as `https://www.company.com`. A staging site needs its own entry. The website key is not secret: it only lets a visitor start a chat, and only on those origins.

The button appears in the bottom right corner. It is small, at about 2 KB, and the chat panel loads only when the browser is idle or someone clicks. Neither can be restyled by the page's CSS, and neither changes the page's styles.

### Sites with a content security policy

Allow your installation's address for `script-src` and `connect-src`. If the website requires Turnstile, also allow `https://challenges.cloudflare.com` for `script-src` and `frame-src`. A `nonce` on the script tag is passed on to the panel, and no `style-src` change is needed.

### Website builders and shops

Each of these pastes the snippet on every page. Afterwards, add every address the site answers on to the **allowed origins**, such as both `https://www.company.com` and `https://company.com`.

| Platform | Where the snippet goes |
|---|---|
| WordPress | A header-and-footer code plugin, in the footer, or the theme's `footer.php` just before `</body>`. A child theme keeps the change through theme updates |
| Shopify | **Online Store** → **Themes** → **⋯** → **Edit code** → `layout/theme.liquid`, just before `</body>`. Allow both the `*.myshopify.com` address and your own domain |
| Wix | **Settings** → **Custom code** → **Add custom code**, on all pages, in **Body - end**. Wix allows this only on some plans |
| Squarespace | **Settings** → **Developer tools** → **Code injection** → **Footer**. Squarespace allows this only on some plans |
| Webflow | **Site settings** → **Custom code** → **Footer code**, then publish |
| Google Tag Manager | A **Custom HTML** tag on **All Pages**, written as below |

In Google Tag Manager, give the key in `OpenChatConfig`, because Tag Manager may not keep `data-` attributes:

```html
<script>window.OpenChatConfig = { websiteKey: 'wk_...' };</script>
<script src="https://chat.company.com/widget/widget.js" async></script>
```

Open the site afterwards and check that the button appears. If it does not, the browser's console names the reason, which is usually an address missing from the allowed origins.

### Single-page apps

React, Vue, Angular, Svelte and similar apps need the snippet once, not on each route. Put it in the page that loads the app, such as `index.html`, just before `</body>`. The button lives outside the app's own elements, so changing route does not remove it, and loading the script a second time does nothing.

In Next.js, add it once in the root layout:

```tsx
import Script from 'next/script';

// In app/layout.tsx, inside <body>:
<Script src="https://chat.company.com/widget/widget.js" data-website-key="wk_..." strategy="afterInteractive" />
```

To change the language when a visitor switches it in your app, reload the page with the new `data-locale`. The widget reads its options once.

## Options

On the script tag, or in `window.OpenChatConfig` before it:

| Attribute | `OpenChatConfig` | What it does |
|---|---|---|
| `data-website-key` | `websiteKey` | Required |
| `data-locale` | `locale` | The widget's language, such as `fr` or `zh-Hant`. For a site in several languages, set it on each page |
| `data-consent="pending"` | `consent: 'pending'` | Stores nothing that outlives the browser tab until the page calls `window.OpenChat.grantConsent()`. For sites that ask for consent first |

The page can also call `window.OpenChat.open()` and `window.OpenChat.close()`, for example from a "Chat with us" link.

## In a mobile app

There is no native SDK. An app shows the widget in a web view, from a chat page on your own website. The widget only loads on an address in the allowed origins, so a page bundled inside the app, which has no web address, cannot load it.

**1. Put a chat page on your site**, such as `https://www.company.com/chat`, and make sure the site's address is in the allowed origins. The page opens the chat as soon as it loads. On a phone, the open chat fills the screen.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Chat</title>
</head>
<body>
  <p>Tap the button to chat with us.</p>
  <script src="https://chat.company.com/widget/widget.js" data-website-key="wk_..." async onload="OpenChat.open()"></script>
</body>
</html>
```

Set `lang`, or `data-locale`, to the app's language. A page that adds the language to its address, such as `/chat?lang=fr`, can put it in `data-locale` before loading the script.

**2. Open that page in the app.** The simplest way is the system's in-app browser, `SFSafariViewController` on iOS or Custom Tabs on Android, which needs no other setup. A web view fits the app more closely, and needs the settings below.

| App | How to show it |
|---|---|
| iOS, Swift | A `WKWebView` with the default data store, so the visitor's conversation is kept between launches. To let visitors attach photos, add `NSPhotoLibraryUsageDescription`, and `NSCameraUsageDescription` if they may take one, to `Info.plist` |
| Android, Kotlin | A `WebView` with `settings.javaScriptEnabled = true` and `settings.domStorageEnabled = true`, without which the conversation is lost. Attaching files needs a `WebChromeClient` that handles `onShowFileChooser` |
| React Native | `<WebView source={{ uri: 'https://www.company.com/chat' }} domStorageEnabled javaScriptEnabled />` from `react-native-webview`. It handles attaching files itself |
| Flutter | `webview_flutter`, with `setJavaScriptMode(JavaScriptMode.unrestricted)`. On Android, attaching files needs `setOnShowFileSelector` on the Android controller |

For example, in Swift:

```swift
import SwiftUI
import WebKit

struct ChatView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        view.load(URLRequest(url: URL(string: "https://www.company.com/chat")!))
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
```

And in Kotlin:

```kotlin
val view = WebView(context).apply {
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = true
    loadUrl("https://www.company.com/chat")
}
```

**What to know:**

- The app's own back or close button closes the chat. The widget's close arrow only shrinks the chat to its button, on the chat page.
- Each app keeps its own conversation, separate from the visitor's browser. Clearing the app's data, or reinstalling it, starts a new one.
- The app is not told about new replies. A visitor sees them while the chat page is open, and when they open it again.

## Languages

The widget speaks English, Spanish, French, German, Italian, Portuguese, Dutch, Japanese, Korean, and Simplified and Traditional Chinese. It uses, in order: `data-locale`, the website's **Widget language** setting, the page's `<html lang>`, the visitor's browser languages, then English.

Your welcome message, and your team's replies, are shown as written. The translations have not yet been checked by native speakers, and right-to-left languages are not supported; see [known issues](../known-issues.md).

## What visitors see

- A button, and a panel with your welcome message.
- One conversation per visitor in that browser. They come back to it on their next visit, unless `data-consent="pending"` was never granted.
- Your team's replies, as they are written, and whether someone is typing. Names only if the website shows them. Never internal notes.
- If the [AI assistant](admin.md#the-ai-assistant) answers visitors, its answers under its name with an **AI** label, and a message when it passes them to your team: the standard one in the visitor's language, or [your own](admin.md#the-ai-assistant) as you wrote it.
- If the website asks for an email, a field for it, and a box to allow follow-up emails, unticked.
- Files they attach, up to 25 MB, of the types the [inbox](inbox.md#answering) accepts.

A visitor's history is tied to their browser, not their email address. Someone who types a customer's address does not see that customer's conversations.

## Privacy on your site

The widget stores a visitor's chat session in the browser's local storage, or only for the tab's lifetime with `data-consent="pending"`. It sets no cookies and loads nothing from third parties, except Cloudflare Turnstile for websites that require it. Mention it in your site's privacy notice; see [privacy and data](privacy.md).

**Ratings.** When your team resolves a conversation, the widget asks the visitor "How did we do?", with **Good** and **Bad**, and then for a comment if they wish, of up to 500 characters. Answering is optional, and they can change their answer while the conversation stays resolved. Your team sees the rating and the comment at the top of the conversation, and supervisors see the totals under Analytics. Only the latest rating of a conversation is kept. An installation admin turns the question off for a website under its widget settings.

**The page a visitor is on.** Once a visitor has started a conversation, the widget tells your team which page of your site they are on, and again when they move to another. Your team sees it at the top of the conversation. What is kept:

- The address without its query or fragment: `https://shop.example/orders/123`, never `?email=…` or `#…`. Those parts do not leave the visitor's browser.
- The current page only. Each page replaces the last, and no history is kept.
- Nothing for someone who has not written to you, and nothing while `data-consent="pending"` holds.
- Only pages on the origins the website allows.

It is on for every website. Whoever runs the installation can turn it off for all of them by setting the Worker variable `VISITOR_PAGE` to `off`; nothing is then sent or kept.

A path can itself say something about a person, such as an order number, so add this to your privacy notice too. It is deleted with the conversation, and is part of a contact's export.
