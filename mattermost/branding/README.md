# Login footer

`launchpad.incubics.com` serves Mattermost Team Edition. These files add the app download footer on the public sign-in screens.

The host nginx site inserts `footer.css` and `footer.js` into the HTML and serves them from `/brand/`. The footer is shown on `/`, `/landing`, and `/login`, and it stays off inside a team workspace.

On `/landing`, the Incubics logo sits to the left of the Mattermost wordmark. The Mattermost name stays on the page.

Inside a channel, `kanban.js` adds a Kanban tab next to Messages. The tab shows the Focalboard board linked to that channel, with its status columns, and cards can be added or moved between columns.

Each message has an Assign action. Choosing a person and a deadline creates a card on that board, and the message shows who owns it and when it is due.

`meetings.js` adds a Meetings tab in the same channel. A member can schedule a meeting with a date, time, length, and a repeat of none, daily, weekdays, weekly, or monthly. The meeting is posted and pinned in the channel, and the tab lists the next time it happens.

| Icon | Link |
| --- | --- |
| Windows | Mattermost desktop 6.3.2 MSI |
| macOS | Mattermost desktop 6.3.2 universal DMG |
| Android | Google Play, `com.mattermost.rn` |
| iOS | App Store, Mattermost `id1257222717` |
