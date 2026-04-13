import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var store: AppStore
    @State private var dailyLimit: String = ""
    @State private var agentLimits: [String: String] = [:]
    @State private var reviewRoles: [String: String] = [:]
    @State private var isSaving = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Settings")
                    .font(.system(size: 20, weight: .bold))

                connectionSection
                budgetSection
                reviewSection
                aboutSection
            }
            .padding(20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task {
            await loadConfig()
        }
    }

    // MARK: - Connection

    private var connectionSection: some View {
        SettingsSection(title: "Connection", icon: "network") {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Backend URL")
                        .font(.system(size: 12))
                        .foregroundColor(.ancMuted)
                    Spacer()
                    Text("http://localhost:3849")
                        .font(.system(size: 12, design: .monospaced))
                }

                HStack {
                    Text("Status")
                        .font(.system(size: 12))
                        .foregroundColor(.ancMuted)
                    Spacer()
                    HStack(spacing: 6) {
                        Circle()
                            .fill(store.connected ? Color.green : Color.red)
                            .frame(width: 8, height: 8)
                        Text(store.connected ? "Connected" : "Disconnected")
                            .font(.system(size: 12))
                            .foregroundColor(store.connected ? .green : .red)
                    }
                }

                if let err = store.lastError {
                    HStack {
                        Text("Last Error")
                            .font(.system(size: 12))
                            .foregroundColor(.ancMuted)
                        Spacer()
                        Text(err)
                            .font(.system(size: 11))
                            .foregroundColor(.red)
                            .lineLimit(2)
                    }
                }

                HStack {
                    Spacer()
                    Button("Reconnect") {
                        Task { await store.refreshAll() }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
        }
    }

    // MARK: - Budget

    private var budgetSection: some View {
        SettingsSection(title: "Budget", icon: "dollarsign.circle") {
            VStack(alignment: .leading, spacing: 12) {
                if let config = store.budgetConfig {
                    // Daily limit
                    HStack {
                        Text("Daily Limit ($)")
                            .font(.system(size: 12))
                            .foregroundColor(.ancMuted)
                        Spacer()
                        TextField("50", text: $dailyLimit)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 80)
                            .font(.system(size: 12))
                    }

                    // Summary
                    if let summary = config.summary, let today = summary.today {
                        HStack {
                            Text("Today's Spend")
                                .font(.system(size: 12))
                                .foregroundColor(.ancMuted)
                            Spacer()
                            let pct = today.limit > 0 ? (today.spent / today.limit * 100) : 0
                            Text(String(format: "$%.2f / $%.0f (%.0f%%)", today.spent, today.limit, pct))
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundColor(pct > 90 ? .red : .ancForeground)
                        }
                    }

                    // Per-agent limits
                    Text("Per-Agent Limits")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.ancMuted)

                    ForEach(Array(config.config.agents.keys.sorted()), id: \.self) { role in
                        HStack {
                            Text(role.capitalized)
                                .font(.system(size: 12))
                            Spacer()
                            TextField("Limit", text: agentLimitBinding(role))
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 80)
                                .font(.system(size: 12))

                            // Show current spend
                            if let summary = config.summary,
                               let perAgent = summary.perAgent,
                               let agentSpend = perAgent[role] {
                                Text(String(format: "$%.2f", agentSpend.spent))
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundColor(.ancMuted)
                                    .frame(width: 60, alignment: .trailing)
                            }
                        }
                    }

                    HStack {
                        Spacer()
                        Button("Save Budget") {
                            saveBudget()
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                        .disabled(isSaving)
                    }
                } else {
                    Text("Loading budget config...")
                        .font(.system(size: 12))
                        .foregroundColor(.ancMuted)
                }
            }
        }
    }

    // MARK: - Review

    private var reviewSection: some View {
        SettingsSection(title: "Review Policy", icon: "checkmark.shield") {
            VStack(alignment: .leading, spacing: 10) {
                if let config = store.reviewConfig {
                    HStack {
                        Text("Default Policy")
                            .font(.system(size: 12))
                            .foregroundColor(.ancMuted)
                        Spacer()
                        Text(config.resolvedDefault ?? config.config.defaultPolicy)
                            .font(.system(size: 12, weight: .medium))
                    }

                    Text("Per-Role Policy")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.ancMuted)

                    ForEach(Array(config.config.roles.keys.sorted()), id: \.self) { role in
                        HStack {
                            Text(role.capitalized)
                                .font(.system(size: 12))
                            Spacer()
                            Picker("", selection: reviewRoleBinding(role)) {
                                Text("Strict").tag("strict")
                                Text("Normal").tag("normal")
                                Text("Lax").tag("lax")
                                Text("Autonomous").tag("autonomous")
                            }
                            .pickerStyle(.menu)
                            .frame(width: 130)
                        }
                    }

                    HStack {
                        Spacer()
                        Button("Save Review") {
                            saveReview()
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                    }
                } else {
                    Text("Loading review config...")
                        .font(.system(size: 12))
                        .foregroundColor(.ancMuted)
                }
            }
        }
    }

    // MARK: - About

    private var aboutSection: some View {
        SettingsSection(title: "About", icon: "info.circle") {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("App")
                        .font(.system(size: 12))
                        .foregroundColor(.ancMuted)
                    Spacer()
                    Text("ANC Dashboard")
                        .font(.system(size: 12))
                }
                HStack {
                    Text("Version")
                        .font(.system(size: 12))
                        .foregroundColor(.ancMuted)
                    Spacer()
                    Text("0.1.0 (Phase 3)")
                        .font(.system(size: 12, design: .monospaced))
                }
                HStack {
                    Text("Platform")
                        .font(.system(size: 12))
                        .foregroundColor(.ancMuted)
                    Spacer()
                    Text("macOS 14+, SwiftUI")
                        .font(.system(size: 12))
                }
            }
        }
    }

    // MARK: - Load / Save

    private func loadConfig() async {
        async let b: () = store.refreshBudgetConfig()
        async let r: () = store.refreshReviewConfig()
        _ = await (b, r)

        if let config = store.budgetConfig {
            dailyLimit = String(format: "%.0f", config.config.daily?.limit ?? 0)
            for (role, limit) in config.config.agents {
                agentLimits[role] = String(format: "%.0f", limit.limit)
            }
        }

        if let config = store.reviewConfig {
            reviewRoles = config.config.roles
        }
    }

    private func saveBudget() {
        isSaving = true
        let daily = Double(dailyLimit)
        var agents: [String: PatchBudgetLimit] = [:]
        for (role, limitStr) in agentLimits {
            if let val = Double(limitStr) {
                agents[role] = PatchBudgetLimit(limit: val, alertAt: nil)
            }
        }
        Task {
            await store.updateBudget(
                daily: daily.map { PatchBudgetLimit(limit: $0, alertAt: nil) },
                agents: agents.isEmpty ? nil : agents
            )
            isSaving = false
        }
    }

    private func saveReview() {
        Task {
            await store.updateReview(roles: reviewRoles)
        }
    }

    private func agentLimitBinding(_ role: String) -> Binding<String> {
        Binding(
            get: { agentLimits[role] ?? "" },
            set: { agentLimits[role] = $0 }
        )
    }

    private func reviewRoleBinding(_ role: String) -> Binding<String> {
        Binding(
            get: { reviewRoles[role] ?? "normal" },
            set: { reviewRoles[role] = $0 }
        )
    }
}

// MARK: - Settings Section

struct SettingsSection<Content: View>: View {
    let title: String
    let icon: String
    let content: () -> Content

    init(title: String, icon: String, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.icon = icon
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 13))
                    .foregroundColor(.ancAccent)
                Text(title)
                    .font(.system(size: 14, weight: .semibold))
            }

            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Color.ancSurface)
        .cornerRadius(10)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.ancBorder, lineWidth: 1))
    }
}
