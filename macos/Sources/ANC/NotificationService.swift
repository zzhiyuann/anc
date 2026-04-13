import Foundation
import UserNotifications
import AppKit

/// Manages native macOS notifications and dock badge updates.
@MainActor
final class NotificationService: NSObject, ObservableObject {
    static let shared = NotificationService()

    private var authorized = false

    override init() {
        super.init()
    }

    // MARK: - Permission

    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            Task { @MainActor in
                self.authorized = granted
            }
        }
        UNUserNotificationCenter.current().delegate = self
    }

    // MARK: - Dock Badge

    func updateDockBadge(unreadCount: Int) {
        NSApp.dockTile.badgeLabel = unreadCount > 0 ? "\(unreadCount)" : nil
    }

    // MARK: - Native Notification

    func deliverCriticalNotification(title: String, body: String, id: String) {
        guard authorized else { return }

        let content = UNMutableNotificationContent()
        content.title = "ANC Alert"
        content.body = "\(title)\(body.isEmpty ? "" : " — \(body)")"
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "anc-notification-\(id)",
            content: content,
            trigger: nil // deliver immediately
        )
        UNUserNotificationCenter.current().add(request)
    }

    /// Check a notification and deliver native alert if critical.
    func checkAndDeliver(_ notification: ANCNotification) {
        let isCritical = (notification.kind == "failure" || notification.kind == "alert")
            && notification.severity == "critical"

        guard isCritical else { return }
        deliverCriticalNotification(
            title: notification.title,
            body: notification.body ?? "",
            id: "\(notification.id)"
        )
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension NotificationService: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        return [.banner, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        // Bring app to front when notification is clicked
        await MainActor.run {
            NSApp.activate(ignoringOtherApps: true)
        }
    }
}
