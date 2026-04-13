import SwiftUI

extension Color {
    // MARK: - Base palette (iOS system colors)

    static let ancBackground = Color(uiColor: .systemBackground)
    static let ancForeground = Color(uiColor: .label)
    static let ancMuted = Color(uiColor: .secondaryLabel)
    static let ancBorder = Color(uiColor: .separator)
    static let ancSurface = Color(uiColor: .secondarySystemBackground)

    static let ancAccent = Color.blue

    // MARK: - Status colors

    static let ancRunning = Color.green
    static let ancFailed = Color.red
    static let ancQueued = Color.yellow
    static let ancSuspended = Color.purple
}
