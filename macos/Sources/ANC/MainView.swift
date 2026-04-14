import SwiftUI

struct MainView: View {
    @EnvironmentObject var store: AppStore
    @State private var selection: NavItem? = .tasks
    @State private var searchText = ""

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
                .transition(.opacity.combined(with: .move(edge: .trailing)))
            } else {
                ContentPane(selection: selection ?? .tasks)
                    .navigationSplitViewColumnWidth(min: 400, ideal: 700)
                    .transition(.opacity.combined(with: .move(edge: .trailing)))
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
        .toolbar {
            ToolbarItem(placement: .navigation) {
                // Leading: sidebar toggle is automatic via SidebarCommands
                EmptyView()
            }

            ToolbarItem(placement: .principal) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundColor(.ancMuted)
                        .font(.inter(12))
                    Text("Search...")
                        .font(.inter(13))
                        .foregroundColor(.ancMuted)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(Color.ancSurface.opacity(0.6))
                .cornerRadius(6)
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color.ancBorder.opacity(0.5), lineWidth: 0.5)
                )
                .onTapGesture {
                    store.showSearch = true
                }
                .help("Search (Cmd+K)")
            }

            ToolbarItemGroup(placement: .automatic) {
                // Connection indicator
                HStack(spacing: 4) {
                    Circle()
                        .fill(store.connected ? Color.ancRunning : Color.ancFailed)
                        .frame(width: 7, height: 7)
                    Text(store.connected ? "Connected" : "Offline")
                        .font(.inter(11))
                        .foregroundColor(.ancMuted)
                }
                .help(store.connected ? "Connected to ANC backend" : "Disconnected from backend")

                // Notification bell with badge
                Button {
                    selection = .inbox
                } label: {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "bell")
                            .font(.inter(14))
                        if store.unreadCount > 0 {
                            Text("\(min(store.unreadCount, 99))")
                                .font(.inter(8, weight: .bold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 3)
                                .padding(.vertical, 1)
                                .background(Color.red)
                                .clipShape(Capsule())
                                .offset(x: 6, y: -6)
                        }
                    }
                }
                .buttonStyle(.borderless)
                .help("Inbox (\(store.unreadCount) unread)")
            }
        }
        .toast($store.toast)
        .animation(.spring(duration: 0.2), value: selection)
        .task { await store.bootstrap() }
        // Search sheet
        .sheet(isPresented: $store.showSearch) {
            SearchSheet()
                .environmentObject(store)
        }
        // Help sheet
        .sheet(isPresented: $store.showHelp) {
            KeyboardShortcutsSheet()
        }
        // Navigation from search or menu commands
        .onChange(of: store.searchNavigateTo) { _, newValue in
            if let nav = newValue {
                withAnimation(.spring(duration: 0.2)) {
                    selection = nav
                }
                store.searchNavigateTo = nil
            }
        }
    }
}
