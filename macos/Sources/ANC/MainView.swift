import SwiftUI

struct MainView: View {
    @EnvironmentObject var store: AppStore
    @State private var selection: NavItem? = .tasks

    var body: some View {
        NavigationSplitView {
            SidebarView(selection: $selection)
                .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 320)
        } content: {
            ContentPane(selection: selection ?? .tasks)
                .navigationSplitViewColumnWidth(min: 400, ideal: 700)
        } detail: {
            InspectorPane()
                .navigationSplitViewColumnWidth(min: 260, ideal: 320, max: 420)
        }
        .navigationSplitViewStyle(.balanced)
        .task { await store.bootstrap() }
    }
}
