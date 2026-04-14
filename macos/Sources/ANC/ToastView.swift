import SwiftUI

// MARK: - Toast Model

struct Toast: Equatable {
    let message: String
    let style: Style

    enum Style {
        case success
        case error
        case info
    }

    var icon: String {
        switch style {
        case .success: return "checkmark.circle.fill"
        case .error: return "xmark.circle.fill"
        case .info: return "info.circle.fill"
        }
    }

    var color: Color {
        switch style {
        case .success: return .green
        case .error: return .red
        case .info: return .blue
        }
    }
}

// MARK: - Toast View

struct ToastView: View {
    let toast: Toast

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: toast.icon)
                .font(.inter(14))
                .foregroundColor(toast.color)

            Text(toast.message)
                .font(.inter(12, weight: .medium))
                .foregroundColor(.primary)
                .lineLimit(2)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .shadow(color: .black.opacity(0.15), radius: 8, y: 4)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}

// MARK: - Toast Modifier

struct ToastModifier: ViewModifier {
    @Binding var toast: Toast?

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let toast {
                ToastView(toast: toast)
                    .padding(.bottom, 20)
                    .onAppear {
                        let autoDismiss = toast.style != .error
                        if autoDismiss {
                            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                                withAnimation(.spring(duration: 0.3)) {
                                    self.toast = nil
                                }
                            }
                        }
                    }
                    .onTapGesture {
                        withAnimation(.spring(duration: 0.3)) {
                            self.toast = nil
                        }
                    }
            }
        }
        .animation(.spring(duration: 0.3), value: toast)
    }
}

extension View {
    func toast(_ toast: Binding<Toast?>) -> some View {
        modifier(ToastModifier(toast: toast))
    }
}
