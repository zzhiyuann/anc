import SwiftUI

struct MembersView: View {
    @EnvironmentObject var store: AppStore
    @State private var searchText = ""
    @State private var selectedRole: String? = nil

    private var filteredAgents: [AgentStatus] {
        if searchText.isEmpty { return store.agents }
        let q = searchText.lowercased()
        return store.agents.filter {
            $0.name.lowercased().contains(q) || $0.role.lowercased().contains(q)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            HStack(spacing: 8) {
                Text("Members")
                    .font(.system(size: 16, weight: .semibold))
                Text("\(filteredAgents.count)")
                    .font(.system(size: 12))
                    .foregroundColor(.ancMuted)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.ancMuted.opacity(0.15))
                    .clipShape(Capsule())
                Spacer()

                Button {
                    Task { await store.refreshAgents() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 12))
                }
                .buttonStyle(.borderless)
                .help("Refresh")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)

            Divider()

            if filteredAgents.isEmpty {
                emptyState
            } else {
                agentList
            }
        }
        .searchable(text: $searchText, placement: .toolbar, prompt: "Search members...")
        .onChange(of: selectedRole) { _, newVal in
            store.selectedAgentRole = newVal
            if let role = newVal {
                Task { await store.fetchAgentDetail(role) }
            }
        }
    }

    private var agentList: some View {
        List(selection: $selectedRole) {
            ForEach(filteredAgents) { agent in
                AgentRowView(agent: agent)
                    .tag(agent.role)
                    .contextMenu {
                        Button("View Detail") {
                            selectedRole = agent.role
                        }
                        Divider()
                        Button("Refresh") {
                            Task { await store.refreshAgents() }
                        }
                    }
            }
        }
        .listStyle(.inset(alternatesRowBackgrounds: true))
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "person.2")
                .font(.system(size: 28))
                .foregroundColor(.ancMuted)
            Text("No agents")
                .font(.system(size: 14, weight: .medium))
            Text("Agents will appear when the backend is running")
                .font(.system(size: 12))
                .foregroundColor(.ancMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Agent Row

struct AgentRowView: View {
    let agent: AgentStatus

    var body: some View {
        HStack(spacing: 10) {
            // Avatar
            Image(systemName: "person.circle.fill")
                .font(.system(size: 24))
                .foregroundColor(statusColor)

            // Name + Role
            VStack(alignment: .leading, spacing: 1) {
                Text(agent.name)
                    .font(.system(size: 13, weight: .medium))
                Text("@\(agent.role)")
                    .font(.system(size: 11))
                    .foregroundColor(.ancMuted)
            }
            .frame(minWidth: 100, alignment: .leading)

            Spacer()

            // Status
            statusPill

            // Sessions
            HStack(spacing: 2) {
                Text("\(agent.activeSessions)")
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundColor(agent.activeSessions > 0 ? .green : .ancMuted)
                Text("/")
                    .font(.system(size: 11))
                    .foregroundColor(.ancMuted)
                Text("\(agent.maxConcurrency)")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundColor(.ancMuted)
            }
            .frame(width: 50)
        }
        .padding(.vertical, 4)
    }

    private var statusColor: Color {
        if agent.activeSessions > 0 { return .green }
        if agent.idleSessions > 0 { return .yellow }
        return .gray
    }

    private var statusPill: some View {
        let (text, color) = statusInfo
        return Text(text)
            .font(.system(size: 10, weight: .medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(color.opacity(0.15))
            .foregroundColor(color)
            .clipShape(Capsule())
    }

    private var statusInfo: (String, Color) {
        if agent.activeSessions > 0 { return ("Active", .green) }
        if agent.idleSessions > 0 { return ("Idle", .yellow) }
        return ("Offline", .gray)
    }
}
