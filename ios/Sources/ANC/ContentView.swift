import SwiftUI

struct ContentView: View {
    @EnvironmentObject var store: AppStore

    var body: some View {
        TabView {
            TasksTab()
                .tabItem {
                    Label("Tasks", systemImage: "checklist")
                }

            InboxTab()
                .tabItem {
                    Label("Inbox", systemImage: "tray")
                }
                .badge(store.unreadCount)

            DashboardTab()
                .tabItem {
                    Label("Dashboard", systemImage: "rectangle.grid.2x2")
                }

            MembersTab()
                .tabItem {
                    Label("Members", systemImage: "person.2")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
        }
        .tint(Color.ancAccent)
    }
}
