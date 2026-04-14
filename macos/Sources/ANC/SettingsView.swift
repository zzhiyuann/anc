import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var store: AppStore
    @State private var dailyLimit: String = ""
    @State private var agentLimits: [String: String] = [:]
    @State private var reviewRoles: [String: String] = [:]
    @State private var isSaving = false
    @State private var editingPersonaRole: String? = nil
    @State private var personaDraft = ""
    @State private var agentConcurrency: [String: Int] = [:]
    @State private var agentDutySlots: [String: Int] = [:]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Settings")
                    .font(.inter(20, weight: .bold))

                connectionSection
                budgetSection
                reviewSection
                agentsSection
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
                        .font(.inter(12))
                        .foregroundColor(.ancMuted)
                    Spacer()
                    Text("http://localhost:3849")
                        .font(.system(size: 12, design: .monospaced))
                }

                HStack {
                    Text("Status")
                        .font(.inter(12))
                        .foregroundColor(.ancMuted)
                    Spacer()
                    HStack(spacing: 6) {
                        Circle()
                            .fill(store.connected ? Color.green : Color.red)
                            .frame(width: 8, height: 8)
                        Text(store.connected ? "Connected" : "Disconnected")
                            .font(.inter(12))
                            .foregroundColor(store.connected ? .green : .red)
                    }
                }

                if let err = store.lastError {
                    HStack {
                        Text("Last Error")
                            .font(.inter(12))
                            .foregroundColor(.ancMuted)
                        Spacer()
                        Text(err)
                            .font(.inter(11))
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
                            .font(.inter(12))
                            .foregroundColor(.ancMuted)
                        Spacer()
                        TextField("50", text: $dailyLimit)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 80)
                            .font(.inter(12))
                    }

                    // Summary
                    if let summary = config.summary, let today = summary.today {
                        HStack {
                            Text("Today's Spend")
                                .font(.inter(12))
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
                        .font(.inter(12, weight: .semibold))
                        .foregroundColor(.ancMuted)

                    ForEach(Array(config.config.agents.keys.sorted()), id: \.self) { role in
                        HStack {
                            Text(role.capitalized)
                                .font(.inter(12))
                            Spacer()
                            TextField("Limit", text: agentLimitBinding(role))
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 80)
                                .font(.inter(12))

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
                        .font(.inter(12))
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
                            .font(.inter(12))
                            .foregroundColor(.ancMuted)
                        Spacer()
                        Text(config.resolvedDefault ?? config.config.defaultPolicy)
                            .font(.inter(12, weight: .medium))
                    }

                    Text("Per-Role Policy")
                        .font(.inter(12, weight: .semibold))
                        .foregroundColor(.ancMuted)

                    ForEach(Array(config.config.roles.keys.sorted()), id: \.self) { role in
                        HStack {
                            Text(role.capitalized)
                                .font(.inter(12))
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
                        .font(.inter(12))
                        .foregroundColor(.ancMuted)
                }
            }
        }
    }

    // MARK: - Agents

    private var agentsSection: some View {
        SettingsSection(title: "Agents", icon: "person.2.circle") {
            VStack(alignment: .leading, spacing: 10) {
                if store.agents.isEmpty {
                    Text("No agents registered")
                        .font(.inter(12))
                        .foregroundColor(.ancMuted)
                } else {
                    ForEach(store.agents) { agent in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 8) {
                                Image(systemName: "person.circle.fill")
                                    .font(.inter(16))
                                    .foregroundColor(.ancAccent)

                                VStack(alignment: .leading, spacing: 1) {
                                    Text(agent.name)
                                        .font(.inter(12, weight: .medium))
                                    Text("@\(agent.role)")
                                        .font(.inter(11))
                                        .foregroundColor(.ancMuted)
                                }

                                Spacer()

                                // Status pill
                                let statusText = agent.activeSessions > 0 ? "Active" : (agent.idleSessions > 0 ? "Idle" : "Offline")
                                let statusColor: Color = agent.activeSessions > 0 ? .green : (agent.idleSessions > 0 ? .yellow : .gray)
                                Text(statusText)
                                    .font(.inter(10, weight: .medium))
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(statusColor.opacity(0.15))
                                    .foregroundColor(statusColor)
                                    .clipShape(Capsule())

                                Button("Edit Persona") {
                                    editingPersonaRole = agent.role
                                    Task {
                                        await store.fetchAgentPersona(agent.role)
                                        personaDraft = store.agentPersona ?? ""
                                    }
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                            }

                            // Editable config row
                            HStack(spacing: 16) {
                                HStack(spacing: 4) {
                                    Text("Max Sessions")
                                        .font(.inter(11))
                                        .foregroundColor(.ancMuted)
                                    Stepper(value: concurrencyBinding(agent.role), in: 1...10) {
                                        Text("\(agentConcurrency[agent.role] ?? agent.maxConcurrency)")
                                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                                            .frame(width: 20)
                                    }
                                    .controlSize(.small)
                                }

                                HStack(spacing: 4) {
                                    Text("Duty Slots")
                                        .font(.inter(11))
                                        .foregroundColor(.ancMuted)
                                    Stepper(value: dutySlotsBinding(agent.role), in: 0...5) {
                                        Text("\(agentDutySlots[agent.role] ?? 0)")
                                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                                            .frame(width: 20)
                                    }
                                    .controlSize(.small)
                                }

                                Spacer()

                                // Only show save button if changed
                                if agentConcurrency[agent.role] != nil || agentDutySlots[agent.role] != nil {
                                    Button("Save") {
                                        Task {
                                            await store.updateAgentConfig(
                                                role: agent.role,
                                                maxConcurrency: agentConcurrency[agent.role],
                                                dutySlots: agentDutySlots[agent.role]
                                            )
                                            agentConcurrency.removeValue(forKey: agent.role)
                                            agentDutySlots.removeValue(forKey: agent.role)
                                        }
                                    }
                                    .buttonStyle(.borderedProminent)
                                    .controlSize(.small)
                                }
                            }
                            .padding(.leading, 24)
                        }

                        if agent.role != store.agents.last?.role {
                            Divider()
                        }
                    }
                }
            }
        }
        .sheet(isPresented: Binding(
            get: { editingPersonaRole != nil },
            set: { if !$0 { editingPersonaRole = nil } }
        )) {
            VStack(spacing: 0) {
                HStack {
                    Text("Edit Persona: \(editingPersonaRole ?? "")")
                        .font(.inter(14, weight: .semibold))
                    Spacer()
                    Button { editingPersonaRole = nil } label: {
                        Image(systemName: "xmark.circle.fill").foregroundColor(.ancMuted)
                    }
                    .buttonStyle(.borderless)
                }
                .padding(16)
                Divider()

                TextEditor(text: $personaDraft)
                    .font(.system(size: 12, design: .monospaced))
                    .padding(8)

                Divider()
                HStack {
                    Spacer()
                    Button("Cancel") { editingPersonaRole = nil }
                    Button("Save") {
                        if let role = editingPersonaRole {
                            Task {
                                await store.saveAgentPersona(role, body: personaDraft)
                            }
                        }
                        editingPersonaRole = nil
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(12)
            }
            .frame(width: 600, height: 500)
        }
    }

    // MARK: - About

    private var aboutSection: some View {
        SettingsSection(title: "About", icon: "info.circle") {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("App")
                        .font(.inter(12))
                        .foregroundColor(.ancMuted)
                    Spacer()
                    Text("ANC Dashboard")
                        .font(.inter(12))
                }
                HStack {
                    Text("Version")
                        .font(.inter(12))
                        .foregroundColor(.ancMuted)
                    Spacer()
                    Text("0.2.0 (Full Parity)")
                        .font(.system(size: 12, design: .monospaced))
                }
                HStack {
                    Text("Platform")
                        .font(.inter(12))
                        .foregroundColor(.ancMuted)
                    Spacer()
                    Text("macOS 14+, SwiftUI")
                        .font(.inter(12))
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

    private func concurrencyBinding(_ role: String) -> Binding<Int> {
        Binding(
            get: { agentConcurrency[role] ?? store.agents.first(where: { $0.role == role })?.maxConcurrency ?? 3 },
            set: { agentConcurrency[role] = $0 }
        )
    }

    private func dutySlotsBinding(_ role: String) -> Binding<Int> {
        Binding(
            get: { agentDutySlots[role] ?? 0 },
            set: { agentDutySlots[role] = $0 }
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
                    .font(.inter(12))
                    .foregroundColor(.ancAccent)
                Text(title)
                    .font(.inter(12, weight: .semibold))
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
