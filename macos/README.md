# ANC macOS Native App

Native SwiftUI client for the ANC backend. Phase 1 scaffold — three-pane window, sidebar, tasks list, basic inspector, REST + WebSocket clients.

## Build

```bash
brew install xcodegen
cd macos
xcodegen generate
xcodebuild -project ANC.xcodeproj -scheme ANC -configuration Debug -derivedDataPath build build
```

If `xcodebuild` complains about a missing `CoreSimulator` plugin, run once:

```bash
xcodebuild -runFirstLaunch
```

## Run

```bash
open macos/build/Build/Products/Debug/ANC.app
```

The app expects the ANC backend on `http://localhost:3849`. If the backend is down, the sidebar shows a red "Disconnected" indicator and the tasks pane shows a Retry button. The app still launches cleanly.

## Architecture

- `ANCApp.swift` — `@main` SwiftUI entry, `WindowGroup` scene.
- `MainView.swift` — `NavigationSplitView` (sidebar + content + inspector).
- `SidebarView.swift` — Inbox / Dashboard / Tasks / Projects / Members / Views / Settings.
- `ContentPane.swift` — switches on selection; tasks/projects/members render real data.
- `InspectorPane.swift` — placeholder + selected task detail.
- `AppStore.swift` — `ObservableObject` holding tasks, projects, agents, notifications, connection state.
- `APIClient.swift` — `actor` URLSession-based REST client (GET/POST/PATCH/DELETE).
- `WebSocketClient.swift` — `URLSessionWebSocketTask` with auto-reconnect, publishes events via Combine.
- `Models.swift` — Codable structs mirroring `apps/web/src/lib/types.ts`.
- `Theme.swift` — `Color.anc*` extensions backed by dynamic `NSColor` (auto dark/light).

No external Swift dependencies — Foundation + SwiftUI + AppKit only.

## Phase Roadmap

1. **Phase 1 (this)** — Scaffold: window, sidebar, tasks list, API + WS clients.
2. **Phase 2** — Tasks view: filtering, grouping, status changes, optimistic updates.
3. **Phase 3** — Task detail: inspector with comments, events, sessions, attachments.
4. **Phase 4** — Properties: assignee, labels, due date, project picker.
5. **Phase 5** — Motion + polish: transitions, hover states, keyboard nav, command palette.
6. **Phase 6** — Sign / notarize / DMG distribution.
