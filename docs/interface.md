# Interface, preferences, and mobile use

[← Documentation](README.md) · [Feature guide](features.md) · [Keyboard shortcuts](features.md#keyboard-shortcuts)

Use **Settings → General** to change themes, fonts, file views, and remote checks. Use **Settings → Shortcuts** to customize keyboard controls.

On desktop, navigation and file lists sit in a resizable sidebar; editors, diffs, commits, PRs, and releases open in the viewer. Phone browsers show one pane at a time. Both clients connect to the same repository backend. Native desktop controls are available only in the desktop app.

## Appearance and settings

General settings groups controls under **Appearance**, **Files & viewer**, and **Repository sync**. Changes apply immediately and preserve your existing selections.

| Control | Choices |
| --- | --- |
| **Theme** | System, light, or dark |
| **Interface size** | Scale text, icons, and controls |
| **Interface font** | Geist, **Plus Jakarta Sans** (default), or Space Grotesk |
| **Code font** | Geist Mono, **JetBrains Mono** (default), Inconsolata, Departure Mono, or Space Grotesk |

Each font selector previews its own typeface. Open **Text preview** to see the current interface and code fonts together.

**Dates use DD/MM/YYYY and local, 24-hour time.** This applies to history, commits, branches, worktrees, PRs, logs, updates, browser sessions, and CLI pairing expiry dates.

<details>
<summary>Syntax colors, loading indicators, and motion</summary>

Diffs, Files editors, merge conflicts, and Markdown code blocks share syntax colors. Diffs and editors keep the active interface background regardless of which view opens first. Tooltips and their arrows follow the active theme.

Loading status uses shimmering text and a primary-colored spinner. Busy buttons retain their spinner and shimmer their label. Text shimmer pauses outside the viewport or while the document is hidden, resumes from the same point when visible, and respects reduced-motion preferences.

</details>

<details>
<summary>Settings layout and secondary dialogs</summary>

Labels and controls sit side by side on desktop and stack on phones. Settings keeps the same desktop frame size as you switch sections; content scrolls inside while navigation and headings remain visible. Its short transition honors reduced-motion preferences.

The frame fits smaller windows and uses available screen height on phones. Browser revocation, LAN confirmation, device rename, and AI history dialogs open at their own size above Settings and diff content.

</details>

### Viewer and saved preferences

Choose a **tree or list** for Changes, enable **line wrapping**, and decide whether to **show Git-ignored files** in General settings.

OpenTig starts in **Files** on first use, then reopens your last active section: Changes, Files, History, PRs, or Search. This choice applies across repositories but is independent for each browser profile or desktop client.

| Remembered item | Behavior |
| --- | --- |
| **Last active section** | Stored in the client. Clearing site data or unavailable local storage returns it to Files; a selected PR or search query is not restored |
| **Workspace preferences** | Sidebar width, viewer preferences, fonts, shortcut customizations, repositories, and projects are remembered |
| **File navigation** | Expanded tree paths and open file tabs are remembered for each worktree |
| **AI model** | Selection is saved per provider |

**Remembered tabs do not save your edits.** Tab paths persist between sessions; unsaved text is not written to disk.

### Remote checks and refresh

Set **Settings → General → Repository sync → Remote check interval** to control periodic checks:

| Interval | Behavior |
| --- | --- |
| **30 seconds** | Default |
| **Preset or custom** | Choose a common interval, or 5–300 seconds in steps of five |
| **Off** | Disables periodic checks; checks still run when you pull or push |

Use the toolbar **Refresh** button or `Ctrl+R` to fetch remote Git changes and then refresh the local workspace, even with automatic checks off. The icon rotates while refreshing and returns to rest afterward.

Refresh also checks for app updates immediately instead of waiting for the five-minute update interval.

The workspace also refreshes automatically when files or Git state change. While another tool keeps writing to the repository, OpenTig shows the newest state it could read and refreshes again after the next change. An automatic refresh that fails retries once after a second and reports an error only if the retry also fails.

### Shortcuts

Open **Settings → Shortcuts** to rebind most shortcuts, check for conflicts, or reset them to defaults. Fixed shortcuts follow platform or file-manager conventions.

You can disable **double-tap-Control**, which brings the desktop app to the front from another application. See the [default shortcut table](features.md#keyboard-shortcuts).

**In a paired browser,** the section omits double-tap-Control because a web page cannot register global shortcuts. Browsers keep some combinations for their own tabs and windows, such as `Ctrl+W`, `Ctrl+T`, `Ctrl+N`, and `Ctrl+Tab`. Commands bound to one of them show a notice there, and those combinations cannot be assigned from the browser. Shortcut changes are shared with the desktop app. Phone layouts hide the section.

## Dropdowns and tooltips

Repository, worktree, branch, AI model, project assignment, and PR base selectors have searchable menus. Repository and worktree choices show a second checkout line; other choices use one line.

- **Find a model:** search by name or identifier; models are grouped by provider.
- **Keep a default:** **Default (CLI)** and **No project** remain available during filtering.
- **Switch repositories by number:** number shortcuts remain active until the search field takes focus.
- **Read a shortened name:** hover a truncated selected name to see it in full. The hint stays while the pointer remains on the control and hides while the menu is open.

Toolbar selectors keep management actions available. Branch and worktree management rows show information in their details panel; diff headers show the file name and directory directly.

<details>
<summary>Long menus, scrolling, and option hints</summary>

Repository menus can grow to 80% of viewport height while search and management remain visible. Other menus remain compact. Menus use the current theme, with larger touch targets on phones and a gap between hovered and selected options. The desktop app keeps its toolbar on one row at its minimum window width. Paired browsers between 768 and 1100 pixels wrap remaining toolbar controls to the right.

With 100 or more matching choices, menus render only visible rows and a small buffer. Group labels, disabled choices, keyboard navigation, and scrolling to the selected choice remain available. Filtering below that size restores the ordinary list. Background option refreshes preserve scroll position.

Options show hints only for truncated text or additional information. Scrolling dismisses row tooltips, and clipped anchors hide their hints.

</details>

## Phone navigation

Use the bottom **Changes**, **Files**, **History**, **PRs**, and **Search** tabs to switch sections; **Releases** is inside **PRs**. Tap the compact repository header's context controls for branches, worktrees, pull/push, and Settings.

| Task | On a phone |
| --- | --- |
| **Review content** | Open a row, then use Back to return to its list |
| **Switch or close a file tab** | Use the open-files button to open the tab sheet |
| **Commit** | Open the separate Commit form; staging controls remain accessible |
| **Pull or push** | Check the pending commit counts. Actions are disabled when up to date; unpublished branches can still be published |

Notifications leave navigation and open sheets accessible. Short landscape phones keep the mobile layout. The bottom navigation hides when the software keyboard opens, and dialogs and forms fit the keyboard and safe areas.

### Files and search

**Files opens one folder at a time.** Use breadcrumbs, the folder filter, action menus, creation controls, and multiple selection to navigate and manage files. Background refreshes preserve the current folder and scroll position.

**Move to…** opens a destination picker with the same folder icons as Files. Touch and pen gestures scroll; desktop mouse dragging remains available.

When adding a repository in a browser, the visual folder picker browses **the backend host**, not the phone's filesystem.

Search keeps its query and options in one compact row. The PR toolbar aligns refresh, filters, and New at a consistent touch-friendly height.

### History, diffs, and projects

- **History:** search and grouping share a mobile toolbar, with compact rows and touch-sized expansion controls.
- **Diffs:** start in unified layout. A phone's layout choice lasts for the session and preserves the saved desktop layout.
- **Projects:** use the larger up/down buttons and free scrolling in Manage projects. Moving a project or repository preserves focus and scroll, then briefly highlights its new position. Reduced-motion preferences suppress that highlight; desktop dragging remains available.

Settings, diagnostics, branch, and worktree controls are also available on touch screens.

## Desktop and Dev identity

Desktop windows reopen at their previous position and size, including maximized state. They stay wide enough for the toolbar to remain on one row and cannot be resized below that width unless the display itself is narrower. If monitor layout or scaling makes a saved position unavailable, the window moves and, when needed, shrinks to fit a display. New windows and disconnected-monitor positions center on the primary display. The welcome screen follows the selected theme and has a draggable top edge.

**OpenTig Dev uses separate data and update behavior.** Its desktop/mobile headers and welcome screen show **OpenTig Dev**, with black/yellow stripes in light mode and white/yellow stripes in dark mode. This identity follows the backend's Dev profile, including in browsers. See [development and packaging](development.md).

<details>
<summary>Application icons and startup screen</summary>

The toolbar, browser favicon, Windows application, installer, and taskbar use the OpenTig logo. Its toolbar ring follows the theme text color while the T stays blue; application icons use a dark rounded badge.

The first painted frame is a splash with shimmering connection status. It stays visible until the workspace restores.

</details>
