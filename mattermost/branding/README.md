# Login footer

`launchpad.incubics.com` serves Mattermost Team Edition. These files add the app download footer on the public sign-in screens.

The host nginx site inserts `footer.css` and `footer.js` into the HTML and serves them from `/brand/`. The footer is shown on `/`, `/landing`, and `/login`, and it stays off inside a team workspace.

On `/landing`, the Incubics logo sits to the left of the Mattermost wordmark. The Mattermost name stays on the page.

Inside a channel, `kanban.js` adds a Kanban tab next to Messages. The tab shows the Focalboard board linked to that channel, with its status columns. Adding a card, or clicking one, opens a ticket page for the title, status, assignee, deadline, and details. An existing ticket can be deleted from that page. Cards can also be moved between columns.

Each message has an Assign action. Choosing a person and a deadline creates a card on that board, and the message shows who owns it and when it is due.

`files.js` adds a Files tab beside Meetings. It lists the files shared in the channel and can upload more. Opening a file fetches it with the signed-in session and then shows or downloads it. Files stay on the Launchpad server, up to 100 MB each. Google Drive is not a file store here: Team Edition only supports local disk and S3-compatible storage, and this site has no Google Cloud OAuth client.

`meetings.js` adds a Schedule meeting bar directly under the channel header, and a Meetings tab beside Messages. A member can schedule a one-time meeting or a repeat of daily, weekdays, weekly, or monthly. The meeting is posted and pinned in the channel, and the post includes a link back to the channel. Everyone in the channel with an email address receives a calendar invite with that same link in the event URL and description. Scheduling does not start a call. The desktop app also loads this bar from the `com.incubics.meetings` webapp plugin, so an open window picks it up without a cached copy of the page.

| Icon | Link |
| --- | --- |
| Windows | Mattermost desktop 6.3.2 MSI |
| macOS | Mattermost desktop 6.3.2 universal DMG |
| Android | Google Play, `com.mattermost.rn` |
| iOS | App Store, Mattermost `id1257222717` |
