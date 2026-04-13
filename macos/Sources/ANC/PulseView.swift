import SwiftUI

struct PulseView: View {
    @EnvironmentObject var store: AppStore
    @State private var showKillSwitchConfirm = false
    @State private var showNewDecision = false
    @State private var newDecisionTitle = ""
    @State private var newDecisionRationale = ""

    var body: some View {
        VStack(spacing: 0) {
            // Top bar
            HStack {
                Text("Dashboard")
                    .font(.system(size: 18, weight: .semibold))
                Spacer()

                Button {
                    Task { await refreshAll() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 12))
                }
                .buttonStyle(.borderless)
                .help("Refresh")

                // Kill Switch
                Button {
                    showKillSwitchConfirm = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: store.killSwitchPaused ? "play.fill" : "stop.fill")
                        Text(store.killSwitchPaused ? "Resume" : "Kill Switch")
                    }
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(store.killSwitchPaused ? Color.green : Color.red)
                    .cornerRadius(6)
                }
                .buttonStyle(.plain)
                .alert(
                    store.killSwitchPaused ? "Resume all agents?" : "Pause all agents?",
                    isPresented: $showKillSwitchConfirm
                ) {
                    Button("Cancel", role: .cancel) { }
                    Button(store.killSwitchPaused ? "Resume" : "Pause", role: store.killSwitchPaused ? .none : .destructive) {
                        Task { await store.toggleKillSwitch() }
                    }
                } message: {
                    Text(store.killSwitchPaused
                         ? "This will resume all suspended agent sessions."
                         : "This will suspend all running agent sessions immediately.")
                }
            }
            .padding(16)
            Divider()

            // Content grid
            ScrollView {
                HStack(alignment: .top, spacing: 16) {
                    // Left column
                    VStack(spacing: 16) {
                        briefingCard
                        needsInputCard
                        winsCard
                    }
                    .frame(maxWidth: .infinity)

                    // Right column
                    VStack(spacing: 16) {
                        okrsCard
                        decisionsCard
                        slowTasksCard
                    }
                    .frame(maxWidth: .infinity)
                }
                .padding(16)
            }
        }
        .task {
            await refreshAll()
        }
    }

    private func refreshAll() async {
        async let b: () = store.refreshBriefing()
        async let o: () = store.refreshObjectives()
        async let d: () = store.refreshDecisions()
        async let k: () = store.refreshKillSwitchStatus()
        async let n: () = store.refreshNotifications()
        _ = await (b, o, d, k, n)
    }

    // MARK: - Daily Briefing Card

    private var briefingCard: some View {
        DashboardCard(title: "Daily Briefing", icon: "sun.max") {
            if let briefing = store.briefing {
                VStack(alignment: .leading, spacing: 10) {
                    // Cost burn
                    if let burn = briefing.costBurn {
                        HStack {
                            Text("Budget:")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundColor(.ancMuted)
                            let pct = burn.budgetUsd > 0 ? (burn.spentUsd / burn.budgetUsd * 100) : 0
                            Text(String(format: "$%.2f / $%.0f (%.0f%%)", burn.spentUsd, burn.budgetUsd, pct))
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundColor(pct > 90 ? .red : (pct > 70 ? .orange : .green))
                        }

                        ProgressView(value: min(burn.spentUsd, burn.budgetUsd), total: max(burn.budgetUsd, 1))
                            .tint(burn.spentUsd > burn.budgetUsd ? .red : .ancAccent)
                    }

                    // Today's queue
                    if !briefing.todayQueue.isEmpty {
                        Text("Today's Queue")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.ancMuted)
                        ForEach(briefing.todayQueue, id: \.self) { item in
                            HStack(spacing: 6) {
                                Image(systemName: "circle")
                                    .font(.system(size: 6))
                                    .foregroundColor(.ancMuted)
                                Text(item)
                                    .font(.system(size: 12))
                                    .lineLimit(1)
                            }
                        }
                    }

                    // Yesterday's completions
                    if !briefing.yesterdayCompletions.isEmpty {
                        Text("Yesterday Completed")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.ancMuted)
                        ForEach(briefing.yesterdayCompletions, id: \.self) { item in
                            HStack(spacing: 6) {
                                Image(systemName: "checkmark.circle")
                                    .font(.system(size: 10))
                                    .foregroundColor(.green)
                                Text(item)
                                    .font(.system(size: 12))
                                    .lineLimit(1)
                            }
                        }
                    }

                    // Risks
                    if !briefing.risks.isEmpty {
                        Text("Risks")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(.red)
                        ForEach(briefing.risks, id: \.self) { risk in
                            HStack(spacing: 6) {
                                Image(systemName: "exclamationmark.triangle")
                                    .font(.system(size: 10))
                                    .foregroundColor(.red)
                                Text(risk)
                                    .font(.system(size: 12))
                            }
                        }
                    }
                }
            } else {
                Text("Loading briefing...")
                    .font(.system(size: 12))
                    .foregroundColor(.ancMuted)
            }
        }
    }

    // MARK: - Needs Input

    private var needsInputCard: some View {
        DashboardCard(title: "Needs Input", icon: "exclamationmark.bubble") {
            let unreadMentions = store.notifications.filter { $0.readAt == nil && $0.kind == "dispatch" }
            if unreadMentions.isEmpty {
                Text("No pending mentions")
                    .font(.system(size: 12))
                    .foregroundColor(.ancMuted)
            } else {
                ForEach(unreadMentions.prefix(5)) { notif in
                    HStack(spacing: 6) {
                        Circle()
                            .fill(Color.blue)
                            .frame(width: 6, height: 6)
                        Text(notif.title)
                            .font(.system(size: 12))
                            .lineLimit(1)
                        Spacer()
                        Text(relativeTime(notif.createdAt))
                            .font(.system(size: 10))
                            .foregroundColor(.ancMuted)
                    }
                }
                if unreadMentions.count > 5 {
                    Text("+\(unreadMentions.count - 5) more")
                        .font(.system(size: 11))
                        .foregroundColor(.ancMuted)
                }
            }
        }
    }

    // MARK: - Wins

    private var winsCard: some View {
        DashboardCard(title: "Recent Wins", icon: "trophy") {
            let doneTasks = store.tasks.filter { $0.state == .done }
                .sorted { ($0.completedAt ?? 0) > ($1.completedAt ?? 0) }
                .prefix(5)

            if doneTasks.isEmpty {
                Text("No completed tasks recently")
                    .font(.system(size: 12))
                    .foregroundColor(.ancMuted)
            } else {
                ForEach(Array(doneTasks)) { task in
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 10))
                            .foregroundColor(.green)
                        Text(task.title)
                            .font(.system(size: 12))
                            .lineLimit(1)
                        Spacer()
                        if let assignee = task.assignee {
                            Text(assignee)
                                .font(.system(size: 10))
                                .foregroundColor(.ancMuted)
                        }
                    }
                }
            }
        }
    }

    // MARK: - OKRs

    private var okrsCard: some View {
        DashboardCard(title: "OKRs", icon: "target") {
            if store.objectives.isEmpty {
                Text("No objectives defined")
                    .font(.system(size: 12))
                    .foregroundColor(.ancMuted)
            } else {
                ForEach(store.objectives) { obj in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(obj.title)
                                .font(.system(size: 13, weight: .medium))
                            Spacer()
                            if let q = obj.quarter {
                                Text(q)
                                    .font(.system(size: 10))
                                    .foregroundColor(.ancMuted)
                            }
                        }

                        ForEach(obj.keyResults) { kr in
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(kr.title)
                                        .font(.system(size: 11))
                                    Spacer()
                                    Text("\(Int(kr.current))/\(Int(kr.target))")
                                        .font(.system(size: 10, design: .monospaced))
                                        .foregroundColor(.ancMuted)
                                }
                                ProgressView(value: min(kr.current, kr.target), total: max(kr.target, 1))
                                    .tint(.ancAccent)
                            }
                        }

                        if obj.keyResults.isEmpty {
                            Text("No key results")
                                .font(.system(size: 11))
                                .foregroundColor(.ancMuted)
                        }
                    }

                    if obj.id != store.objectives.last?.id {
                        Divider()
                    }
                }
            }
        }
    }

    // MARK: - Decisions

    private var decisionsCard: some View {
        DashboardCard(title: "Decision Log", icon: "doc.plaintext") {
            VStack(alignment: .leading, spacing: 8) {
                if store.decisions.isEmpty {
                    Text("No decisions logged")
                        .font(.system(size: 12))
                        .foregroundColor(.ancMuted)
                } else {
                    ForEach(store.decisions.prefix(5)) { decision in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(decision.title)
                                    .font(.system(size: 12, weight: .medium))
                                Spacer()
                                if let by = decision.decidedBy {
                                    Text(by)
                                        .font(.system(size: 10))
                                        .foregroundColor(.ancMuted)
                                }
                            }
                            if let rationale = decision.rationale {
                                Text(rationale)
                                    .font(.system(size: 11))
                                    .foregroundColor(.ancMuted)
                                    .lineLimit(2)
                            }
                            if !decision.tags.isEmpty {
                                HStack(spacing: 4) {
                                    ForEach(decision.tags, id: \.self) { tag in
                                        Text(tag)
                                            .font(.system(size: 9))
                                            .padding(.horizontal, 5)
                                            .padding(.vertical, 1)
                                            .background(Color.ancAccent.opacity(0.1))
                                            .foregroundColor(.ancAccent)
                                            .cornerRadius(3)
                                    }
                                }
                            }
                        }

                        if decision.id != store.decisions.prefix(5).last?.id {
                            Divider()
                        }
                    }
                }

                Button {
                    showNewDecision = true
                } label: {
                    Label("New Decision", systemImage: "plus")
                        .font(.system(size: 11))
                }
                .buttonStyle(.borderless)
                .sheet(isPresented: $showNewDecision) {
                    newDecisionSheet
                }
            }
        }
    }

    // MARK: - Slow Tasks

    private var slowTasksCard: some View {
        DashboardCard(title: "Slow Tasks", icon: "tortoise") {
            let runningTasks = store.tasks.filter { $0.state == .running }
                .sorted { ($0.createdAt ?? 0) < ($1.createdAt ?? 0) }
                .prefix(5)

            if runningTasks.isEmpty {
                Text("No running tasks")
                    .font(.system(size: 12))
                    .foregroundColor(.ancMuted)
            } else {
                ForEach(Array(runningTasks)) { task in
                    HStack(spacing: 6) {
                        Circle()
                            .fill(Color.blue)
                            .frame(width: 6, height: 6)
                        Text(task.title)
                            .font(.system(size: 12))
                            .lineLimit(1)
                        Spacer()
                        if let ts = task.createdAt {
                            Text(relativeTime(ts))
                                .font(.system(size: 10))
                                .foregroundColor(.ancMuted)
                        }
                    }
                }
            }
        }
    }

    // MARK: - New Decision Sheet

    private var newDecisionSheet: some View {
        VStack(spacing: 16) {
            Text("New Decision")
                .font(.system(size: 16, weight: .semibold))

            TextField("Title", text: $newDecisionTitle)
                .textFieldStyle(.roundedBorder)

            TextField("Rationale", text: $newDecisionRationale)
                .textFieldStyle(.roundedBorder)

            HStack {
                Spacer()
                Button("Cancel") {
                    showNewDecision = false
                    newDecisionTitle = ""
                    newDecisionRationale = ""
                }
                Button("Create") {
                    let title = newDecisionTitle
                    let rationale = newDecisionRationale
                    showNewDecision = false
                    newDecisionTitle = ""
                    newDecisionRationale = ""
                    Task {
                        await store.createDecision(
                            title: title,
                            rationale: rationale.isEmpty ? nil : rationale,
                            tags: []
                        )
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(newDecisionTitle.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 400)
    }
}

// MARK: - Dashboard Card

struct DashboardCard<Content: View>: View {
    let title: String
    let icon: String
    let content: () -> Content

    init(title: String, icon: String, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.icon = icon
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 12))
                    .foregroundColor(.ancAccent)
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
            }

            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Color.ancSurface)
        .cornerRadius(10)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.ancBorder, lineWidth: 1))
    }
}
