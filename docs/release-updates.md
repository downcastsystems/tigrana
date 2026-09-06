# Release notices

Native macOS and Windows builds check the public GitHub release feed shortly after launch and while the app remains open. Successful checks are cached for 24 hours. Failed checks stay quiet and can retry after an hour when the app is focused again.

When the published version is newer than the installed version, the tab bar shows an update button. It opens that release's notes and downloads in the browser. Dismissing the notice hides that version across notebook windows and restarts. A later version can still show a notice.

The check sends a public release API request to GitHub. It does not send notebook contents or paths. Check results and dismissal preferences live in app-local storage, outside notebooks. The browser demo does not check for updates.

## Publishing an update

1. Run the existing Official release workflow and wait for the platform builds and verification to finish.
2. Review the draft release and its download assets on GitHub.
3. Publish it as a stable release. Drafts and prereleases do not trigger a notice.

The checker uses GitHub's [latest release endpoint](https://docs.github.com/en/rest/releases/releases#get-the-latest-release) for `downcastsystems/tigrana` and compares numeric `vMAJOR.MINOR.PATCH` tags with the running Tauri app version. Download and installation remain user actions.

People need a build containing this feature before they can receive notices for subsequent releases.
