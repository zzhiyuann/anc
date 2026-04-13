import SwiftUI

struct SidebarView: View {
    @EnvironmentObject var store: AppStore
    @Binding var selection: NavItem?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack(spacing: 8) {
                Circle()
                    .fill(Color.ancAccent)
                    .frame(width: 22, height: 22)
                    .overlay(Text("A").font(.system(size: 12, weight: .bold)).foregroundColor(.white))
                Text("ANC")
                    .font(.system(size: 14, weight: .semibold))
                Spacer()
                ConnectionDot(connected: store.connected)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)

            Divider()

            List(selection: $selection) {
                Section {
                    row(.inbox, badge: store.notifications.filter { $0.readAt == nil }.count)
                    row(.dashboard)
                }

                Section("Workspace") {
                    row(.tasks, badge: store.tasks.count)
                    row(.projects, badge: store.projects.count)
                    row(.members, badge: store.agents.count)
                    row(.views)
                }

                Section {
                    row(.settings)
                }
            }
            .listStyle(.sidebar)

            Divider()
            HStack(spacing: 6) {
                ConnectionDot(connected: store.connected)
                Text(store.connected ? "Connected" : "Disconnected")
                    .font(.system(size: 11))
                    .foregroundColor(.ancMuted)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
    }

    @ViewBuilder
    private func row(_ item: NavItem, badge: Int? = nil) -> some View {
        NavigationLink(value: item) {
            HStack {
                Image(systemName: item.systemImage)
                    .frame(width: 18)
                Text(item.title)
                Spacer()
                if let badge, badge > 0 {
                    Text("\(badge)")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.ancMuted)
                }
            }
        }
    }
}

struct ConnectionDot: View {
    let connected: Bool
    var body: some View {
        Circle()
            .fill(connected ? Color.green : Color.red)
            .frame(width: 8, height: 8)
    }
}
