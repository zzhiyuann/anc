import SwiftUI

struct KeyboardShortcutsSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Keyboard Shortcuts")
                    .font(.system(size: 16, weight: .semibold))
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundColor(.ancMuted)
                }
                .buttonStyle(.borderless)
                .keyboardShortcut(.escape, modifiers: [])
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    shortcutSection("Global", shortcuts: [
                        ("Search", "K"),
                        ("Refresh", "R"),
                        ("Settings", ","),
                        ("Toggle Sidebar", "S"),
                        ("Show Inspector", "I"),
                        ("Keyboard Shortcuts", "?"),
                    ], modifier: "Cmd")

                    shortcutSection("Navigation", shortcuts: [
                        ("Inbox", "1"),
                        ("Dashboard", "2"),
                        ("Tasks", "3"),
                        ("Projects", "4"),
                        ("Members", "5"),
                        ("Settings", ","),
                    ], modifier: "Cmd")

                    shortcutSection("Tasks", shortcuts: [
                        ("New Task", "N"),
                        ("Delete Task", "Backspace"),
                        ("Navigate Up", "\u{2191}"),
                        ("Navigate Down", "\u{2193}"),
                    ], modifier: "")

                    shortcutSection("Search (Cmd+K)", shortcuts: [
                        ("Navigate Up", "\u{2191}"),
                        ("Navigate Down", "\u{2193}"),
                        ("Select Result", "Return"),
                        ("Close", "Esc"),
                    ], modifier: "")

                    shortcutSection("Inbox", shortcuts: [
                        ("Mark Read", "M"),
                        ("Archive", "E"),
                    ], modifier: "")
                }
                .padding(20)
            }
        }
        .frame(width: 420, height: 480)
        .background(Color.ancBackground)
    }

    private func shortcutSection(_ title: String, shortcuts: [(String, String)], modifier: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundColor(.ancForeground)

            ForEach(shortcuts, id: \.0) { label, key in
                HStack {
                    Text(label)
                        .font(.system(size: 12))
                        .foregroundColor(.ancForeground)
                    Spacer()
                    shortcutBadge(modifier: modifier, key: key)
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func shortcutBadge(modifier: String, key: String) -> some View {
        HStack(spacing: 3) {
            if !modifier.isEmpty {
                keyCap(modifier)
            }
            keyCap(key)
        }
    }

    private func keyCap(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .medium, design: .rounded))
            .foregroundColor(.ancMuted)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(Color.ancSurface)
            .cornerRadius(4)
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(Color.ancBorder, lineWidth: 0.5)
            )
    }
}
