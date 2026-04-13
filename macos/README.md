# ANC macOS Native App

Native SwiftUI client for the ANC backend. Full-featured three-pane window with Tasks, Projects, Members, Agents, Inbox, Pulse, and Settings views. REST + WebSocket real-time updates. No external Swift dependencies.

## Install

1. Download `ANC.dmg`
2. Open the DMG
3. Drag ANC.app to Applications
4. Launch ANC from Applications
5. Make sure the ANC backend is running: `cd /path/to/anc && anc serve`
6. The app connects to localhost:3849 automatically

## Build from Source

```bash
brew install xcodegen
cd macos
xcodegen generate
xcodebuild -project ANC.xcodeproj -scheme ANC -configuration Release \
  -derivedDataPath build \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO \
  build
open build/Build/Products/Release/ANC.app
```

If `xcodebuild` complains about a missing `CoreSimulator` plugin, run once:

```bash
xcodebuild -runFirstLaunch
```

## Create DMG

```bash
mkdir -p build/dmg
cp -R build/Build/Products/Release/ANC.app build/dmg/
ln -s /Applications build/dmg/Applications
hdiutil create -volname "ANC" -srcfolder build/dmg -ov -format UDZO build/ANC.dmg
rm -rf build/dmg
```

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

The app expects the ANC backend on `http://localhost:3849`. If the backend is down, the sidebar shows a red "Disconnected" indicator and the tasks pane shows a Retry button.
