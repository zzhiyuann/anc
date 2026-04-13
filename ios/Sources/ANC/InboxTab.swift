import SwiftUI

struct InboxTab: View {
    @EnvironmentObject var store: AppStore
    @State private var selectedNotification: ANCNotification? = nil

    var body: some View {
        NavigationStack {
            List {
                if store.notifications.isEmpty {
                    ContentUnavailableView("No Notifications", systemImage: "tray", description: Text("You're all caught up."))
                } else {
                    ForEach(store.notifications) { notif in
                        Button {
                            selectedNotification = notif
                            if notif.readAt == nil {
                                Task { await store.markNotificationRead(notif.id) }
                            }
                        } label: {
                            NotificationRowView(notification: notif)
                        }
                        .swipeActions(edge: .trailing) {
                            Button {
                                Task { await store.archiveNotification(notif.id) }
                            } label: {
                                Label("Archive", systemImage: "archivebox")
                            }
                            .tint(.orange)
                        }
                        .swipeActions(edge: .leading) {
                            if notif.readAt == nil {
                                Button {
                                    Task { await store.markNotificationRead(notif.id) }
                                } label: {
                                    Label("Read", systemImage: "envelope.open")
                                }
                                .tint(.blue)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Inbox")
            .refreshable {
                await store.refreshNotifications()
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    if store.unreadCount > 0 {
                        Button {
                            Task { await store.markAllNotificationsRead() }
                        } label: {
                            Image(systemName: "envelope.open")
                        }
                    }
                }
            }
            .sheet(item: $selectedNotification) { notif in
                NotificationDetailSheet(notification: notif)
            }
        }
    }
}

// MARK: - Notification Row

struct NotificationRowView: View {
    let notification: ANCNotification

    private var isUnread: Bool { notification.readAt == nil }

    private var severityColor: Color {
        switch notification.severity {
        case "critical": return .red
        case "warning": return .orange
        case "success": return .green
        default: return .blue
        }
    }

    private var severityIcon: String {
        switch notification.severity {
        case "critical": return "exclamationmark.triangle.fill"
        case "warning": return "exclamationmark.circle.fill"
        case "success": return "checkmark.circle.fill"
        default: return "info.circle.fill"
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: severityIcon)
                .foregroundStyle(severityColor)
                .font(.title3)

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(notification.title)
                        .font(isUnread ? .subheadline.weight(.semibold) : .subheadline)
                        .lineLimit(2)
                    Spacer()
                    if isUnread {
                        Circle()
                            .fill(Color.ancAccent)
                            .frame(width: 8, height: 8)
                    }
                }

                HStack(spacing: 6) {
                    Text(notification.kind)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(formatTimestamp(notification.createdAt))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func formatTimestamp(_ ts: Double) -> String {
        let date = Date(timeIntervalSince1970: ts)
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

// MARK: - Notification Detail Sheet

struct NotificationDetailSheet: View {
    @EnvironmentObject var store: AppStore
    let notification: ANCNotification
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(notification.title)
                            .font(.title3.weight(.semibold))

                        if let body = notification.body, !body.isEmpty {
                            Text(body)
                                .font(.body)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Section {
                    LabeledContent("Kind", value: notification.kind)
                    LabeledContent("Severity", value: notification.severity)
                    if let taskId = notification.taskId {
                        NavigationLink(value: taskId) {
                            HStack {
                                Text("Linked Task")
                                Spacer()
                                Text(taskId)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    LabeledContent("Created") {
                        Text(Date(timeIntervalSince1970: notification.createdAt), style: .relative)
                    }
                }

                Section {
                    HStack(spacing: 16) {
                        if notification.readAt == nil {
                            Button {
                                let generator = UIImpactFeedbackGenerator(style: .light)
                                generator.impactOccurred()
                                Task { await store.markNotificationRead(notification.id) }
                            } label: {
                                Label("Mark Read", systemImage: "envelope.open")
                            }
                        }

                        Button {
                            let generator = UIImpactFeedbackGenerator(style: .medium)
                            generator.impactOccurred()
                            Task {
                                await store.archiveNotification(notification.id)
                                dismiss()
                            }
                        } label: {
                            Label("Archive", systemImage: "archivebox")
                        }
                        .foregroundStyle(.orange)
                    }
                }
            }
            .navigationTitle("Notification")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: String.self) { taskId in
                TaskDetailView(taskId: taskId)
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
