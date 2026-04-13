import SwiftUI

struct DashboardTab: View {
    @EnvironmentObject var store: AppStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    // Connection status
                    if !store.connected {
                        HStack {
                            Image(systemName: "wifi.slash")
                                .foregroundStyle(.red)
                            Text(store.lastError ?? "Not connected")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .padding()
                        .frame(maxWidth: .infinity)
                        .background(.red.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .padding(.horizontal)
                    }

                    // Briefing card
                    BriefingCard()

                    // Quick stats
                    QuickStatsCard()

                    // OKRs
                    OKRsCard()

                    // Budget
                    BudgetCard()

                    // Quick Actions
                    QuickActionsCard()
                }
                .padding(.vertical)
            }
            .navigationTitle("Dashboard")
            .refreshable {
                async let b: () = store.refreshBriefing()
                async let o: () = store.refreshObjectives()
                async let d: () = store.refreshBudgetConfig()
                async let k: () = store.refreshKillSwitchStatus()
                async let r: () = store.refreshAll()
                _ = await (b, o, d, k, r)
            }
            .task {
                async let b: () = store.refreshBriefing()
                async let o: () = store.refreshObjectives()
                async let d: () = store.refreshBudgetConfig()
                async let k: () = store.refreshKillSwitchStatus()
                _ = await (b, o, d, k)
            }
        }
    }
}

// MARK: - Briefing Card

struct BriefingCard: View {
    @EnvironmentObject var store: AppStore

    var body: some View {
        DashboardCard(title: "Daily Briefing", icon: "sun.max.fill") {
            if let briefing = store.briefing {
                VStack(alignment: .leading, spacing: 10) {
                    if !briefing.wins.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Label("Wins", systemImage: "trophy.fill")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.green)
                            ForEach(briefing.wins, id: \.self) { win in
                                Text("- \(win)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    if !briefing.risks.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Label("Risks", systemImage: "exclamationmark.triangle.fill")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.orange)
                            ForEach(briefing.risks, id: \.self) { risk in
                                Text("- \(risk)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    if !briefing.todayQueue.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Label("Today's Queue", systemImage: "list.bullet")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Color.ancAccent)
                            ForEach(briefing.todayQueue.prefix(5), id: \.self) { item in
                                Text("- \(item)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    if let cost = briefing.costBurn {
                        HStack {
                            Label("Cost", systemImage: "dollarsign.circle")
                                .font(.caption.weight(.semibold))
                            Spacer()
                            Text(String(format: "$%.2f / $%.2f", cost.spentUsd, cost.budgetUsd))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            } else {
                Text("Loading briefing...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Quick Stats Card

struct QuickStatsCard: View {
    @EnvironmentObject var store: AppStore

    private var tasksByState: [TaskEntityState: Int] {
        Dictionary(grouping: store.tasks, by: { $0.state }).mapValues(\.count)
    }

    var body: some View {
        DashboardCard(title: "Overview", icon: "chart.bar.fill") {
            LazyVGrid(columns: [
                GridItem(.flexible()),
                GridItem(.flexible()),
                GridItem(.flexible()),
            ], spacing: 12) {
                StatCell(label: "Running", value: "\(tasksByState[.running] ?? 0)", color: .blue)
                StatCell(label: "Review", value: "\(tasksByState[.review] ?? 0)", color: .orange)
                StatCell(label: "Todo", value: "\(tasksByState[.todo] ?? 0)", color: .gray)
                StatCell(label: "Done", value: "\(tasksByState[.done] ?? 0)", color: .green)
                StatCell(label: "Failed", value: "\(tasksByState[.failed] ?? 0)", color: .red)
                StatCell(label: "Agents", value: "\(store.agents.count)", color: .purple)
            }
        }
    }
}

struct StatCell: View {
    let label: String
    let value: String
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.title2.weight(.bold))
                .foregroundStyle(color)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - OKRs Card

struct OKRsCard: View {
    @EnvironmentObject var store: AppStore

    var body: some View {
        if !store.objectives.isEmpty {
            DashboardCard(title: "OKRs", icon: "target") {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(store.objectives) { obj in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(obj.title)
                                .font(.subheadline.weight(.medium))
                            ForEach(obj.keyResults) { kr in
                                HStack {
                                    Text(kr.title)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                    Spacer()
                                    ProgressView(value: kr.target > 0 ? min(kr.current / kr.target, 1.0) : 0)
                                        .frame(width: 60)
                                    Text(String(format: "%.0f%%", kr.target > 0 ? (kr.current / kr.target * 100) : 0))
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Budget Card

struct BudgetCard: View {
    @EnvironmentObject var store: AppStore

    var body: some View {
        if let budget = store.budgetConfig {
            DashboardCard(title: "Budget", icon: "dollarsign.circle.fill") {
                VStack(alignment: .leading, spacing: 8) {
                    if let summary = budget.summary, let today = summary.today {
                        HStack {
                            Text("Today")
                                .font(.subheadline)
                            Spacer()
                            Text(String(format: "$%.2f / $%.2f", today.spent, today.limit))
                                .font(.subheadline.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        ProgressView(value: today.limit > 0 ? min(today.spent / today.limit, 1.0) : 0)
                            .tint(today.spent / max(today.limit, 0.01) > 0.9 ? .red : Color.ancAccent)
                    }

                    if budget.disabled == true {
                        Label("Budget limits disabled", systemImage: "infinity")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }
            }
        }
    }
}

// MARK: - Quick Actions Card

struct QuickActionsCard: View {
    @EnvironmentObject var store: AppStore

    var body: some View {
        DashboardCard(title: "Quick Actions", icon: "bolt.fill") {
            VStack(spacing: 10) {
                Button {
                    let generator = UIImpactFeedbackGenerator(style: .heavy)
                    generator.impactOccurred()
                    Task { await store.toggleKillSwitch() }
                } label: {
                    HStack {
                        Image(systemName: store.killSwitchPaused ? "play.circle.fill" : "stop.circle.fill")
                        Text(store.killSwitchPaused ? "Resume All Agents" : "Kill Switch — Pause All")
                    }
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(store.killSwitchPaused ? Color.green.opacity(0.15) : Color.red.opacity(0.15))
                    .foregroundStyle(store.killSwitchPaused ? .green : .red)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }

                Button {
                    store.showCreateTask = true
                } label: {
                    HStack {
                        Image(systemName: "plus.circle.fill")
                        Text("New Task")
                    }
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.ancAccent.opacity(0.15))
                    .foregroundStyle(Color.ancAccent)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }
        }
    }
}

// MARK: - Dashboard Card Container

struct DashboardCard<Content: View>: View {
    let title: String
    let icon: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .foregroundStyle(Color.ancAccent)
                Text(title)
                    .font(.headline)
            }

            content()
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.ancSurface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal)
    }
}
