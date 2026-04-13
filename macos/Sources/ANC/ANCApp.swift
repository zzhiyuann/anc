import SwiftUI

@main
struct ANCApp: App {
    @StateObject private var store = AppStore()

    var body: some Scene {
        WindowGroup {
            MainView()
                .environmentObject(store)
                .frame(minWidth: 900, minHeight: 600)
        }
        .windowStyle(.hiddenTitleBar)
        .windowToolbarStyle(.unified(showsTitle: false))
        .defaultSize(width: 1280, height: 800)
        .commands {
            // Standard sidebar toggle
            SidebarCommands()

            // File menu
            CommandGroup(after: .newItem) {
                Button("New Task") {
                    store.showCreateTask = true
                }
                .keyboardShortcut("n", modifiers: .command)
            }

            // View menu
            CommandGroup(after: .sidebar) {
                Button("Show Inspector") {
                    // Inspector is always visible in 3-pane; this is a no-op placeholder
                    // for future toggle behavior
                }
                .keyboardShortcut("i", modifiers: [.command, .shift])
            }

            // Navigate menu
            CommandMenu("Navigate") {
                Button("Inbox") {
                    store.searchNavigateTo = .inbox
                }
                .keyboardShortcut("1", modifiers: .command)

                Button("Dashboard") {
                    store.searchNavigateTo = .dashboard
                }
                .keyboardShortcut("2", modifiers: .command)

                Button("Tasks") {
                    store.searchNavigateTo = .tasks
                }
                .keyboardShortcut("3", modifiers: .command)

                Button("Projects") {
                    store.searchNavigateTo = .projects
                }
                .keyboardShortcut("4", modifiers: .command)

                Button("Members") {
                    store.searchNavigateTo = .members
                }
                .keyboardShortcut("5", modifiers: .command)

                Button("Settings") {
                    store.searchNavigateTo = .settings
                }
                .keyboardShortcut(",", modifiers: .command)
            }

            // Go menu
            CommandMenu("Go") {
                Button("Search...") {
                    store.showSearch = true
                }
                .keyboardShortcut("k", modifiers: .command)

                Button("Keyboard Shortcuts") {
                    store.showHelp = true
                }
                .keyboardShortcut("/", modifiers: [.command, .shift])
            }
        }
    }
}
