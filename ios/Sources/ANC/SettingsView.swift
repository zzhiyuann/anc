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
                            let generator = UIImpactFeedbackGenerator(style: .medium)
                            generator.impactOccurred()
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

                // Budget section
                Section {
                    if let budget = store.budgetConfig {
                        if let summary = budget.summary, let today = summary.today {
                            HStack {
                                Text("Daily Limit")
                                Spacer()
                                Text(String(format: "$%.2f", today.limit))
                                    .foregroundStyle(.secondary)
                            }

                            HStack {
                                Text("Today's Spend")
                                Spacer()
                                Text(String(format: "$%.2f", today.spent))
                                    .foregroundStyle(today.spent / max(today.limit, 0.01) > 0.9 ? .red : .secondary)
                            }

                            ProgressView(value: today.limit > 0 ? min(today.spent / today.limit, 1.0) : 0)
                                .tint(today.spent / max(today.limit, 0.01) > 0.9 ? .red : Color.ancAccent)
                        }

                        if let summary = budget.summary, let perAgent = summary.perAgent, !perAgent.isEmpty {
                            ForEach(Array(perAgent.keys.sorted()), id: \.self) { agentRole in
                                if let agentBudget = perAgent[agentRole] {
                                    HStack {
                                        Text(agentRole)
                                            .font(.subheadline)
                                        Spacer()
                                        Text(String(format: "$%.2f / $%.2f", agentBudget.spent, agentBudget.limit))
                                            .font(.subheadline.monospacedDigit())
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }

                        Toggle(isOn: Binding(
                            get: { budget.disabled == true },
                            set: { _ in
                                let generator = UIImpactFeedbackGenerator(style: .medium)
                                generator.impactOccurred()
                                Task { await store.toggleUnlimitedMode() }
                            }
                        )) {
                            HStack {
                                Image(systemName: "infinity")
                                    .foregroundStyle(.orange)
                                Text("Unlimited Mode")
                            }
                        }
                    } else {
                        HStack {
                            ProgressView()
                                .controlSize(.small)
                            Text("Loading budget...")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                } header: {
                    Text("Budget")
                } footer: {
                    Text("Unlimited mode disables all daily and per-agent spend limits.")
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
            .task {
                await store.refreshBudgetConfig()
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
