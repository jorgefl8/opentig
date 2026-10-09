# Interface, preferences, and mobile use

[← Documentation](README.md) · [Feature guide](features.md) · [Keyboard shortcuts](features.md#keyboard-shortcuts)

The desktop workspace keeps navigation and file lists in a resizable sidebar, with editors, diffs, commits, and PRs in the viewer. Phone browsers use one pane at a time. Both clients connect to the same repository backend; native desktop controls remain available only in the desktop app.

## Appearance and settings

**Settings → General** groups Appearance, Files & viewer, and Repository sync into compact rows, with labels and controls side by side on desktop and stacked on phones. Changes apply immediately and preserve existing selections.

Choose system, light, or dark theme and adjust interface scale. Interface fonts are Geist, Plus Jakarta Sans, and Space Grotesk; code fonts are Geist Mono, JetBrains Mono, Inconsolata, Departure Mono, and Space Grotesk. Defaults are **Plus Jakarta Sans** and **JetBrains Mono**. Each font selector previews its own typeface, and the optional text preview reflects the current interface and code selections.

Diffs, Files editors, merge conflicts, and Markdown code blocks share syntax colors; diffs and editors keep the active interface background regardless of which view opens first. Tooltips and their arrows follow the active theme. Loading status uses shimmering text and a primary-colored spinner; busy action buttons retain their spinner and shimmer their label.

Dates use **DD/MM/YYYY** throughout history, commits, branches, worktrees, PRs, logs, updates, and browser sessions. Timestamps use local time in 24-hour format, and CLI pairing expiry dates follow the same convention.

All Settings sections share a desktop frame that keeps its size as sections change. Content scrolls inside while navigation and headings remain visible, with a short transition that honors reduced-motion preferences. The frame fits smaller windows and uses available screen height on phones. Secondary dialogs such as browser revocation, LAN confirmation, device rename, and AI history open at their own size above Settings and diff content.

### Viewer and saved preferences

Choose tree or list layout for Changes, line wrapping for viewers, and whether Git-ignored files are visible. OpenTig remembers sidebar width, viewer preferences, fonts, shortcut customizations, repositories, projects, expanded file-tree paths, and open file tabs for each worktree. AI model selection is saved per provider. Tab paths are remembered between sessions; unsaved text is not written to disk.

### Remote checks and refresh

Remote checks default to every 30 seconds. General settings offers common intervals, a custom value from 5 to 300 seconds in steps of five, and **Off** for manual checks. Turning periodic checks off keeps checks on pull and push.

The toolbar Refresh button and `Ctrl+R` fetch remote Git changes, then refresh the local workspace, even when automatic checks are off. The icon rotates during refresh and returns to rest afterward. Refresh also checks for app updates immediately instead of waiting for the five-minute update interval.

### Shortcuts

Rebind most shortcuts in **Settings → Shortcuts**, with conflict detection and reset to defaults. Fixed shortcuts follow platform or file-manager conventions. You can disable double-tap-Control, which brings the desktop app to the front from another application. See the [default shortcut table](features.md#keyboard-shortcuts).

## Dropdowns and tooltips

Repository, worktree, branch, AI model, project assignment, and PR base selectors share searchable menus in the current theme. Repositories and worktrees show a second checkout line; other choices use one line. Phone menus use larger touch targets, and a gap separates hovered and selected options.

Hover a truncated selected name to see it in full; its tooltip stays while the pointer remains on the control and hides while the menu is open. Options show hints only for truncated text or additional information. Scrolling dismisses row tooltips, and clipped anchors hide their hints. Branch and worktree management rows use their details panel instead of hover hints. Diff headers show the file name and directory directly.

Repository menus can grow to 80% of viewport height while search and management remain visible; other menus remain compact. Toolbar selectors keep management actions available. Models can be searched by name or identifier and grouped by provider. **Default (CLI)** and **No project** remain available during filtering; repository number shortcuts stay active until the search field takes focus. In narrow desktop windows, wrapped toolbar controls stay aligned to the right.

## Phone navigation

Phone browsers have a compact repository header and bottom **Changes**, **Files**, **History**, **PRs**, and **Search** navigation. Tap repository context for branch, worktree, pull/push, and Settings controls. Pull and Push show pending commit counts and stay disabled when up to date; unpublished branches can still be published.

Open a row to review content and use Back to return to its list. The open-files button opens a sheet for switching or closing tabs. The Commit form opens separately so staging controls stay accessible. Notifications leave navigation and open sheets accessible. Short landscape phones keep the mobile layout, while the bottom navigation hides when the software keyboard opens. Dialogs and forms fit the keyboard and safe areas.

### Files and search

Files opens one folder at a time with breadcrumbs, a folder filter, visible action menus, creation controls, and multiple selection. Background refreshes preserve the current folder and scroll position. **Move to…** chooses a destination using the same folder icons as Files. Touch and pen gestures scroll; desktop mouse dragging remains available.

The browser repository dialog chooses folders on the backend host with a visual picker. Search keeps its query and options in one compact row. The PR toolbar aligns refresh, filters, and New at a consistent touch-friendly height.

### History, diffs, and projects

History combines search and grouping in a mobile toolbar with compact rows and touch-sized expansion controls. Phone diffs start unified with a session-only layout choice, preserving the saved desktop layout.

Manage projects uses larger up/down buttons and free scrolling on phones. Moving a project or repository preserves focus and scroll, then briefly highlights its new position; reduced-motion preferences suppress that highlight. Dragging remains available on desktop. Settings, diagnostics, branch, and worktree controls remain available on touch screens.

## Desktop and Dev identity

The toolbar, browser favicon, Windows application, installer, and taskbar use the OpenTig logo. In the toolbar, its ring follows the theme text color and the T remains blue; application icons use a dark rounded badge. The first painted frame is a splash that remains until the workspace restores, with shimmering connection status.

Desktop windows reopen at the previous position and size, including maximized state. If monitor layout or scaling makes a saved position unavailable, the window moves and, when needed, shrinks to fit a display. New windows and disconnected-monitor positions center on the primary display. The welcome screen has a draggable top edge and follows the selected theme.

Development profiles display **OpenTig Dev** in desktop/mobile headers and the welcome screen, with black/yellow stripes in light mode and white/yellow stripes in dark mode. The identity follows the backend's Dev profile, including in browsers. Dev has separate data and update behavior; see [development and packaging](development.md).
