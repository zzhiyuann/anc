import SwiftUI
import AppKit

extension Color {
    // MARK: - Base palette (auto dark/light via NSColor dynamic providers)

    static let ancBackground = Color(NSColor.windowBackgroundColor)
    static let ancForeground = Color(NSColor.labelColor)
    static let ancMuted = Color(NSColor.secondaryLabelColor)
    static let ancBorder = Color(NSColor.separatorColor)
    static let ancSurface = Color(NSColor.controlBackgroundColor)

    static let ancAccent = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .accessibilityHighContrastDarkAqua]) != nil
            ? NSColor(red: 0.04, green: 0.52, blue: 1.0, alpha: 1.0)   // #0A84FF
            : NSColor(red: 0.0, green: 0.44, blue: 0.89, alpha: 1.0)   // #0071E3
    })

    // MARK: - Status colors (dynamic dark/light)

    static let ancRunning = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .accessibilityHighContrastDarkAqua]) != nil
            ? NSColor(red: 0.19, green: 0.82, blue: 0.35, alpha: 1.0)  // #30D158
            : NSColor(red: 0.20, green: 0.78, blue: 0.35, alpha: 1.0)  // #34C759
    })

    static let ancFailed = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .accessibilityHighContrastDarkAqua]) != nil
            ? NSColor(red: 1.0, green: 0.27, blue: 0.23, alpha: 1.0)   // #FF453A
            : NSColor(red: 1.0, green: 0.23, blue: 0.19, alpha: 1.0)   // #FF3B30
    })

    static let ancQueued = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .accessibilityHighContrastDarkAqua]) != nil
            ? NSColor(red: 1.0, green: 0.84, blue: 0.04, alpha: 1.0)   // #FFD60A
            : NSColor(red: 1.0, green: 0.80, blue: 0.0, alpha: 1.0)    // #FFCC00
    })

    static let ancSuspended = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .accessibilityHighContrastDarkAqua]) != nil
            ? NSColor(red: 0.75, green: 0.35, blue: 0.95, alpha: 1.0)  // #BF5AF2
            : NSColor(red: 0.69, green: 0.32, blue: 0.87, alpha: 1.0)  // #AF52DE
    })
}

// MARK: - Reusable Loading View

struct LoadingStateView: View {
    let message: String

    init(_ message: String = "Loading...") {
        self.message = message
    }

    var body: some View {
        VStack(spacing: 10) {
            ProgressView()
                .controlSize(.regular)
            Text(message)
                .font(.system(size: 12))
                .foregroundColor(.ancMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Reusable Error View with Retry

struct ErrorStateView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 28))
                .foregroundColor(.ancFailed)
            Text("Something went wrong")
                .font(.system(size: 14, weight: .medium))
            Text(message)
                .font(.system(size: 12))
                .foregroundColor(.ancMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
            Button("Retry") {
                onRetry()
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Reusable Empty State View

struct EmptyStateView: View {
    let icon: String
    let title: String
    let subtitle: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 28))
                .foregroundColor(.ancMuted)
            Text(title)
                .font(.system(size: 14, weight: .medium))
            Text(subtitle)
                .font(.system(size: 12))
                .foregroundColor(.ancMuted)
            if let actionTitle, let action {
                Button(actionTitle) { action() }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
