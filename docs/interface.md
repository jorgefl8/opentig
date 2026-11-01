# Interface, preferences, and mobile use

[← Documentation](README.md) · [Feature guide](features.md) · [Keyboard shortcuts](features.md#keyboard-shortcuts)

Use **Settings → General** to change themes, fonts, file views, and remote checks. Use **Settings → Shortcuts** to customize keyboard controls.

On desktop, navigation, file lists, and the commit composer sit in a resizable sidebar; editors, diffs, commits, PRs, and releases open in the viewer. Phone browsers show one pane at a time. Both clients connect to the same repository backend. Native desktop controls are available only in the desktop app.

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

Labels and controls share one line where the control fits, and the control wraps below its label where it doesn't. Settings keeps the same desktop frame size as you switch sections; content scrolls inside while navigation and headings remain visible. Its short transition honors reduced-motion preferences.

The frame fits smaller windows. Browser revocation, LAN confirmation, device rename, and AI history dialogs open at their own size above Settings and diff content.

</details>

### Viewer and saved preferences

Choose a **tree or list** for Changes, enable **line wrapping**, and decide whether to **show Git-ignored files** in General settings.

OpenTig starts in **Files** on first use, then reopens your last active section: Changes, Files, History, GitHub, or Search. This choice applies across repositories but is independent for each browser profile or desktop client.

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

The top bar starts with the OpenTig logo and name, then reads as a breadcrumb: the repository in a soft box with its icon and switcher key, the branch, and the branch's pull request number, colored by its state: green when open, gray with **Draft** for a draft, purple when merged, and red when closed. On the right it shows **Pull** or **Push** counts and **Publish** only when the branch needs them, then **Refresh**, any update or fetch notice, and **Settings**.

- **Repository menu:** repositories, then **Open repository…** (`Ctrl+O`), **Open on GitHub** for GitHub repositories, and **Manage projects…**.
- **Worktrees:** with more than one, a small button with their number sits beside the repository. Its menu lists them and **Manage worktrees…**, and its tooltip names the current one.
- **Branch menu:** local and remote branches and **Manage branches…**, plus **Manage worktrees…** while there is only one worktree. A branch checked out in another worktree says **Open**, and choosing it opens that worktree. While an operation makes the repository read-only, branches can't be chosen but other worktrees can.

Branch and worktree management rows show information in their details panel; diff headers show the directory and file name directly.

<details>
<summary>Long menus, scrolling, and option hints</summary>

Repository menus can grow to 80% of viewport height while search and management remain visible. Other menus remain compact. Menus use the current theme, with larger touch targets on phones and a gap between hovered and selected options. Above the phone layout the top bar stays on one row at any width: a long branch name truncates, and hovering it shows the full name.

With 100 or more matching choices, menus render only visible rows and a small buffer. Group labels, disabled choices, keyboard navigation, and scrolling to the selected choice remain available. Filtering below that size restores the ordinary list. Background option refreshes preserve scroll position.

Options show hints only for truncated text or additional information. Scrolling dismisses row tooltips, and clipped anchors hide their hints.

</details>

## Phone navigation

Use the bottom **Changes**, **Files**, **History**, **GitHub**, and **Search** tabs to switch sections; **Pull requests** and **Releases** are tabs inside **GitHub**.

**On a list, the top bar says where you are.** Beside the logo, its two lines name the repository and the branch, with the branch's pull request number in the same colors when it has one. Tap them for the repository sheet: **Repository**, **Branch**, **Worktree** when there are several, then whichever of **Publish this branch** or **Push** and **Pull** applies, **Refresh**, the branch's pull request, **Open on GitHub**, and **Open another repository**. To the right, a pill shows the sync action that applies: **Publish**, **Push** with its count, or **Pull** with its count. When both apply it shows **Pull**, because that has to happen first, and **Push** stays in the sheet. The gear opens Settings. Warnings about the remote and available updates appear here too.

**Inside a viewer, the top bar is about what you opened:** a back arrow, a title, and that thing's actions. Focus moves to the arrow when a viewer opens.

| Viewer | Title | Actions |
| --- | --- | --- |
| **Diff** | File name, then folder and lines added and removed | Stage or unstage. **⋯**: **Open file**, **Wrap lines**, **Discard changes** |
| **File** | File name. Tap it for the sheet of open files, to switch, close, and see which are unsaved or missing | **⋯**: what the file's row in Files offers, such as **Rename**, **Copy path**, **Move to…**, **Delete** |
| **Commit** | Short hash | **⋯**: **Copy hash**, the pull request its message refers to, **Open on GitHub**, **Undo commit…** |
| **Pull request** | Number, then source and base branch | **⋯**: the pull request menu, plus **Disable auto-merge** when it's on |
| **Release** | Tag | **⋯**: the release menu |

**Each screen has at most one main action,** floating above the bottom bar on a fade. Lists and viewers leave extra room at their end while it shows, and it hides while the software keyboard is open.

| Screen | Main action |
| --- | --- |
| **Changes** with staged files, or a commit plan | The commit box, described below |
| **Pull request, Summary** | Its primary action, such as **Merge**, **Merge when ready**, **Update branch**, or **Ready for review**. Nothing floats when there's only a reason to give, such as a conflict |
| **Pull request, Timeline** | A one-line **Write a comment** field that opens the composer in a sheet. A draft stays when the sheet closes, and shows on the field |
| **Pull request, Code** | None, so the screen goes to the code |
| **Draft release** | **Publish**. It's disabled with the reason above it when the tag doesn't exist or the account can't publish |
| **A file with unsaved edits** | **Save** |

The commit box stays above the bottom bar in **Changes** while something is staged, and above the keyboard while you type. It holds the message, your AI provider, and the commit button, whose arrow chooses **Commit** or **Commit and push** without running anything. A suggested plan appears above it with its groups and scrolls inside. Opening a diff and coming back keeps the message and the plan, and generating carries on until it finishes or you cancel it.

Actions that ask first do so in a sheet with the same checks as on desktop: merging shows **Method** as a picker and **Delete branch** as a switch where they apply, one button, and the account underneath. A sheet can't be dismissed while its answer is being sent. A notification that arrives while a sheet is open appears at the top of the screen, above the sheet.

Pull requests and releases scroll as one: the header goes away with the content, and the **Summary**, **Timeline**, and **Code** tabs stick to the top of the screen. On **Code** the header gives way to the tabs alone and the code has its own scroller. Its files start as a list with lines added and removed; tap one to read its diff.

**Settings opens as a tall sheet.** It leads with the general settings, followed by a row for each other section. Tap a row to drill in, and use the back arrow to return. **Branches and worktrees** and **Create pull request** fill the screen the same way and keep their close button, since they don't drag away.

The tabs float over the content in a glass bar. The current section shows its name and the others show an icon, with their names still available to screen readers. A dot on **Changes** means the worktree has changes while you are in another section. A dot on **Files** means a file has unsaved edits. Lists and viewers scroll under the bar and leave room at their end, so the last row or line can always be scrolled clear of it. The bar is solid instead of glass when the device asks for reduced transparency, when the browser has no background blur, and on low-end Android phones.

Sheets slide up from the bottom. Drag one down, press outside it, or press Escape to close it. A slow drag that stops short lets the sheet return to its place.

Notifications appear above the bottom bar and any main action, and leave navigation accessible. Short landscape phones keep the mobile layout with a lower, narrower bar. The bottom bar hides when the software keyboard opens, and dialogs, sheets, and forms fit the keyboard and safe areas.

### Lists: one visible action, the rest behind a long press

Rows show their name and at most one action. **Press and hold a row** for the rest: a sheet opens at about half a second, and a tap, a scroll, or moving your finger leaves it closed. With a mouse, right-click the row; with a keyboard, press the menu key on it or Tab to its **More actions** button, which also lists the actions for screen readers.

When you open something from a list and come back, the list is where you left it.

### Changes

Changes is **always a flat list on a phone**, whichever of **Tree** or **List** you chose. That choice stays saved for the desktop layout. Conflicts come first, then **Staged** and **Not staged**, with **Stage all** or **Unstage all** beside the count.

A row has the file's name, its folder when it isn't at the root, its status letter, and a **+** or **−** button at the far right to stage or unstage it. Tap the row for its diff, or its preview for an image, SVG, or HTML file; the diff has its own stage button and **⋯**. There are no folder rows, so staging a whole folder isn't available on a phone; **Stage all** is.

Press and hold a row for:

| Row | Sheet |
| --- | --- |
| **Not staged** | **Open file** and **Discard changes**, which asks first. A file that opens on its preview adds **View changes**. A whole new folder offers only **Discard changes** |
| **Staged** | **Open file**. A file that opens on its preview adds **View changes** |
| **Conflict** | **Open file**. Tap the row to resolve it |

### Files

**Files opens one folder at a time.** A row is an icon and a name, and folders have a chevron. Inside a folder, a line with a back arrow and the folder's path takes you up a level. The filter narrows the current folder. Background refreshes preserve the current folder and scroll position.

The **⋯** beside the filter offers **Open files** with their count, **Find a file by name**, **Select**, **New file**, **New folder**, **Paste here** where the clipboard allows it, and **Undo** and **Redo** of file operations.

Press and hold a file or folder for its sheet, with its path and size at the top: **Keep file open** or **Open folder**, **Move to…**, **Rename**, **Copy path**, **Copy contents**, **Delete**, and **Copy**, **Cut**, **Paste here**, and **Reveal in file manager** where they're available.

**Select** puts a checkbox on every row and docks a bar above the bottom bar with **Move to…**, **Copy** or **Copy paths**, **Cut**, and **Delete**. **Cancel** beside the filter ends it.

**Move to…** opens a destination picker with the same folder icons as Files. Touch and pen gestures scroll; desktop mouse dragging remains available.

When adding a repository in a browser, the visual folder picker browses **the backend host**, not the phone's filesystem.

### Search

Search keeps its query and matching toggles in one field. The chevron beside it opens a sheet with **Include ignored files** and **Replace…**. Results show each file's path with its matches below, wrapped to two lines at most. Tap a match to open the file at that line. **Replace…** adds the replacement field, and a button on each match and file.

### History, GitHub, diffs, and projects

- **History:** a row is a dot, the commit's title, and one line with its date, author, and short hash. Tap it for the commit, whose **⋯** copies the hash and offers **Undo commit…** and the pull request its message refers to, and whose file list opens each diff. The filter icon beside the find field opens a sheet with **Group merges**.
- **GitHub:** a row is a status dot, a title, and one line. Tap it for the viewer, which has the row's stack and **Open on GitHub**. **Pull requests** and **Releases** keep their filter, menu, and New as icons beside the tabs.
- **Diffs and code:** a phone always shows diffs inline and leaves the saved desktop layout as it is. Text is compact, and **Interface size** scales it; that setting scales nothing else on a phone. Long lines wrap by default. Turning that off, from a diff's **⋯** or from Settings, lasts for the session and leaves the saved desktop choice as it is.
- **Projects:** use the larger up/down buttons and free scrolling in Manage projects. Moving a project or repository preserves focus and scroll, then briefly highlights its new position. Reduced-motion preferences suppress that highlight; desktop dragging remains available.

Settings, diagnostics, branch, and worktree controls are also available on touch screens.

## Desktop and Dev identity

Desktop windows reopen at their previous position and size, including maximized state. They have a minimum width and cannot be resized below it unless the display itself is narrower. If monitor layout or scaling makes a saved position unavailable, the window moves and, when needed, shrinks to fit a display. New windows and disconnected-monitor positions center on the primary display. The welcome screen follows the selected theme and has a draggable top edge.

**OpenTig Dev uses separate data and update behavior.** Its desktop/mobile headers and welcome screen show **OpenTig Dev**, with black/yellow stripes in light mode and white/yellow stripes in dark mode. This identity follows the backend's Dev profile, including in browsers. See [development and packaging](development.md).

<details>
<summary>Application icons and startup screen</summary>

The startup screen, browser favicon, Windows application, installer, and taskbar use the OpenTig logo. On the startup screen its ring follows the theme text color while the T stays blue; application icons use a dark rounded badge.

The first painted frame is a splash with shimmering connection status. It stays visible until the workspace restores.

</details>
