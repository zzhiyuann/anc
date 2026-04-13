import SwiftUI

enum InboxFilter: String, CaseIterable {
    case all = "All"
    case unread = "Unread"
    case mentions = "Mentions"
    case alerts = "Alerts"
}

struct InboxView: View {
    @EnvironmentObject var store: AppStore
    @State private var filter: InboxFilter = .all
    @State private var selectedId: Int? = nil

    private var filteredNotifications: [ANCNotification] {
        let all = store.notifications
        switch filter {
        case .all: return all
        case .unread: return all.filter { $0.readAt == nil }
        case .mentions: return all.filter { $0.kind == "dispatch" }
        case .alerts: return all.filter { $0.kind == "budget" || $0.severity == "critical" }
        }
    }

    private var selectedNotification: ANCNotification? {
        guard let id = selectedId else { return nil }
        return store.notifications.first { $0.id == id }
    }

    var body: some View {
        NavigationSplitView {
            VStack(spacing: 0) {
                // Header
                HStack(spacing: 8) {
                    Text("Inbox")
                        .font(.system(size: 16, weight: .semibold))
                    let unread = store.notifications.filter { $0.readAt == nil }.count
                    if unread > 0 {
                        Text("\(unread)")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.red)
                            .clipShape(Capsule())
                    }
                    Spacer()

                    Button {
                        Task { await store.markAllNotificationsRead() }
                    } label: {
                        Text("Mark all read")
                            .font(.system(size: 11))
                    }
                    .buttonStyle(.borderless)

                    Button {
                        Task { await store.refreshNotifications() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 12))
                    }
                    .buttonStyle(.borderless)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)

                // Filter tabs
                HStack(spacing: 0) {
                    ForEach(InboxFilter.allCases, id: \.self) { f in
                        Button {
                            withAnimation(.spring(duration: 0.2)) { filter = f }
                        } label: {
                            Text(f.rawValue)
                                .font(.system(size: 11, weight: filter == f ? .semibold : .regular))
                                .foregroundColor(filter == f ? .ancAccent : .ancMuted)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(filter == f ? Color.ancAccent.opacity(0.1) : Color.clear)
                                .cornerRadius(6)
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer()
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 4)

                Divider()

                // Notification list
                if filteredNotifications.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "tray")
                            .font(.system(size: 24))
                            .foregroundColor(.ancMuted)
                        Text("No notifications")
                            .font(.system(size: 13))
                            .foregroundColor(.ancMuted)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(selection: $selectedId) {
                        ForEach(filteredNotifications) { notif in
                            NotificationRowView(notification: notif)
                                .tag(notif.id)
                        }
                    }
                    .listStyle(.sidebar)
                }
            }
            .navigationSplitViewColumnWidth(min: 280, ideal: 340, max: 500)
        } detail: {
            if let notif = selectedNotification {
                notificationDetail(notif)
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "tray")
                        .font(.system(size: 28))
                        .foregroundColor(.ancMuted)
                    Text("Select a notification")
                        .font(.system(size: 14))
                        .foregroundColor(.ancMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task {
            await store.refreshNotifications()
        }
    }

    // MARK: - Detail

    private func notificationDetail(_ notif: ANCNotification) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Kind icon + title
                HStack(spacing: 10) {
                    Image(systemName: kindIcon(notif.kind))
                        .font(.system(size: 20))
                        .foregroundColor(severityColor(notif.severity))
                    Text(notif.title)
                        .font(.system(size: 18, weight: .bold))
                }

                // Metadata
                HStack(spacing: 12) {
                    Label(notif.kind.capitalized, systemImage: "tag")
                        .font(.system(size: 12))
                        .foregroundColor(.ancMuted)
                    Label(notif.severity.capitalized, systemImage: "exclamationmark.triangle")
                        .font(.system(size: 12))
                        .foregroundColor(severityColor(notif.severity))
                    Text(formatDate(notif.createdAt))
                        .font(.system(size: 12))
                        .foregroundColor(.ancMuted)
                }

                Divider()

                // Body
                if let body = notif.body, !body.isEmpty {
                    Text(body)
                        .font(.system(size: 14))
                        .textSelection(.enabled)
                } else {
                    Text("No additional details")
                        .font(.system(size: 13))
                        .foregroundColor(.ancMuted)
                }

                // Linked task
                if let taskId = notif.taskId {
                    Button {
                        store.selectTask(taskId)
                    } label: {
                        Label("View linked task", systemImage: "link")
                            .font(.system(size: 12))
                    }
                    .buttonStyle(.bordered)
                }

                Divider()

                // Actions
                HStack(spacing: 12) {
                    if notif.readAt == nil {
                        Button {
                            Task { await store.markNotificationRead(notif.id) }
                        } label: {
                            Label("Mark Read", systemImage: "envelope.open")
                        }
                        .buttonStyle(.bordered)
                    }

                    Button {
                        Task { await store.archiveNotification(notif.id) }
                        selectedId = nil
                    } label: {
                        Label("Archive", systemImage: "archivebox")
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding(20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func formatDate(_ epoch: Double) -> String {
        let date = Date(timeIntervalSince1970: epoch / 1000)
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Notification Row

struct NotificationRowView: View {
    let notification: ANCNotification

    var body: some View {
        HStack(spacing: 8) {
            // Kind icon
            Image(systemName: kindIcon(notification.kind))
                .font(.system(size: 14))
                .foregroundColor(severityColor(notification.severity))
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(notification.title)
                        .font(.system(size: 12, weight: notification.readAt == nil ? .semibold : .regular))
                        .lineLimit(1)
                    Spacer()
                    if notification.readAt == nil {
                        Circle()
                            .fill(Color.blue)
                            .frame(width: 6, height: 6)
                    }
                }

                HStack {
                    if let body = notification.body, !body.isEmpty {
                        Text(body)
                            .font(.system(size: 11))
                            .foregroundColor(.ancMuted)
                            .lineLimit(1)
                    }
                    Spacer()
                    Text(relativeTime(notification.createdAt))
                        .font(.system(size: 10))
                        .foregroundColor(.ancMuted)
                }
            }
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
    }
}

// MARK: - Helpers

private func kindIcon(_ kind: String) -> String {
    switch kind {
    case "budget": return "dollarsign.circle"
    case "dispatch": return "paperplane.circle"
    case "alert": return "exclamationmark.triangle"
    case "mention": return "at"
    default: return "bell"
    }
}

private func severityColor(_ severity: String) -> Color {
    switch severity {
    case "critical": return .red
    case "warning": return .orange
    case "info": return .blue
    default: return .gray
    }
}
