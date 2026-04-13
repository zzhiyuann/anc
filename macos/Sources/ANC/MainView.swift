import SwiftUI

struct MainView: View {
    @EnvironmentObject var store: AppStore
    @State private var selection: NavItem? = .tasks

    var body: some View {
        NavigationSplitView {
            SidebarView(selection: $selection)
                .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 320)
        } content: {
            if selection == .tasks {
                // Tasks: left = task list, center = detail
                HSplitView {
                    TaskListView()
                        .frame(minWidth: 280, idealWidth: 320, maxWidth: 450)
                        .environmentObject(store)
                    TaskDetailView()
                        .frame(minWidth: 350)
                        .environmentObject(store)
                }
                .navigationSplitViewColumnWidth(min: 600, ideal: 800)
            } else {
                ContentPane(selection: selection ?? .tasks)
                    .navigationSplitViewColumnWidth(min: 400, ideal: 700)
            }
        } detail: {
            if selection == .tasks {
                TaskInspectorView()
                    .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 400)
            } else {
                InspectorPane()
                    .navigationSplitViewColumnWidth(min: 260, ideal: 320, max: 420)
            }
        }
        .navigationSplitViewStyle(.balanced)
        .task { await store.bootstrap() }
    }
}
