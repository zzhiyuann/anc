import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var store: AppStore
    @State private var serverURL: String = ""
    @State private var connectionStatus: ConnectionStatus = .unknown
    @State private var isTesting = false

    enum ConnectionStatus {
        case unknown, testing, success, failure
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Server URL", text: $serverURL)
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .onSubmit { saveURL() }

                    HStack {
                        Button {
                            saveURL()
                            testConnection()
                        } label: {
                            HStack(spacing: 6) {
                                if isTesting {
                                    ProgressView()
                                        .controlSize(.small)
                                }
                                Text("Test Connection")
                            }
                        }
                        .disabled(isTesting)

                        Spacer()

                        connectionStatusLabel
                    }
                } header: {
                    Text("Server")
                } footer: {
                    Text("Enter the URL of your ANC server (e.g., http://192.168.1.100:3849)")
                }

                Section {
                    LabeledContent("Connection") {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(store.connected ? Color.green : Color.red)
                                .frame(width: 8, height: 8)
                            Text(store.connected ? "Connected" : "Disconnected")
                        }
                    }
                    LabeledContent("Tasks", value: "\(store.tasks.count)")
                    LabeledContent("Agents", value: "\(store.agents.count)")
                    LabeledContent("Unread", value: "\(store.unreadCount)")
                } header: {
                    Text("Status")
                }

                Section {
                    LabeledContent("App Version", value: "0.1.0")
                    LabeledContent("Platform", value: "iOS")
                } header: {
                    Text("About")
                }
            }
            .navigationTitle("Settings")
            .onAppear {
                serverURL = store.serverURL
            }
        }
    }

    @ViewBuilder
    private var connectionStatusLabel: some View {
        switch connectionStatus {
        case .success:
            Label("Connected", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
                .font(.subheadline)
        case .failure:
            Label("Failed", systemImage: "xmark.circle.fill")
                .foregroundStyle(.red)
                .font(.subheadline)
        case .testing:
            EmptyView()
        case .unknown:
            if store.connected {
                Label("Connected", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .font(.subheadline)
            }
        }
    }

    private func saveURL() {
        let trimmed = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        store.serverURL = trimmed
    }

    private func testConnection() {
        isTesting = true
        connectionStatus = .testing
        Task {
            let success = await store.testConnection()
            isTesting = false
            connectionStatus = success ? .success : .failure
            if success {
                let generator = UINotificationFeedbackGenerator()
                generator.notificationOccurred(.success)
                await store.refreshAll()
            } else {
                let generator = UINotificationFeedbackGenerator()
                generator.notificationOccurred(.error)
            }
        }
    }
}
