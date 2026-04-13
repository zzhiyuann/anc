import SwiftUI

struct InspectorPane: View {
    @EnvironmentObject var store: AppStore

    var body: some View {
        Group {
            if let id = store.selectedTaskId, let task = store.tasks.first(where: { $0.id == id }) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(task.title).font(.system(size: 16, weight: .semibold))
                    HStack {
                        Circle().fill(task.state.color).frame(width: 8, height: 8)
                        Text(task.state.displayName).font(.system(size: 12)).foregroundColor(.ancMuted)
                    }
                    if let desc = task.description, !desc.isEmpty {
                        Text(desc).font(.system(size: 12)).foregroundColor(.ancForeground)
                    }
                    Divider()
                    LabelRow("ID", task.id)
                    if let p = task.projectId { LabelRow("Project", p) }
                    if let a = task.assignee { LabelRow("Assignee", a) }
                    LabelRow("Priority", "\(task.priority)")
                    Spacer()
                }
                .padding(16)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                VStack(spacing: 4) {
                    Text("Select a task")
                        .font(.system(size: 13))
                        .foregroundColor(.ancMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Color.ancBackground)
    }
}

private struct LabelRow: View {
    let label: String
    let value: String
    init(_ label: String, _ value: String) { self.label = label; self.value = value }
    var body: some View {
        HStack {
            Text(label).font(.system(size: 11)).foregroundColor(.ancMuted).frame(width: 80, alignment: .leading)
            Text(value).font(.system(size: 12, design: .monospaced)).lineLimit(1)
            Spacer()
        }
    }
}
