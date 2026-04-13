import SwiftUI

struct CreateTaskSheet: View {
    @EnvironmentObject var store: AppStore
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var description = ""
    @State private var selectedAgent: String? = nil
    @State private var priority: Int = 3
    @State private var selectedProject: String? = nil
    @State private var isCreating = false

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("New Task")
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
            }
            .padding(16)

            Divider()

            // Form
            VStack(alignment: .leading, spacing: 14) {
                // Title
                VStack(alignment: .leading, spacing: 4) {
                    Text("Title")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.ancMuted)
                    TextField("Task title", text: $title)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 13))
                }

                // Description
                VStack(alignment: .leading, spacing: 4) {
                    Text("Description")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.ancMuted)
                    TextEditor(text: $description)
                        .font(.system(size: 13))
                        .frame(minHeight: 80, maxHeight: 150)
                        .padding(4)
                        .background(Color.ancSurface)
                        .cornerRadius(6)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.ancBorder, lineWidth: 1))
                }

                // Agent
                HStack {
                    Text("Agent")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.ancMuted)
                        .frame(width: 70, alignment: .leading)
                    Picker("", selection: $selectedAgent) {
                        Text("Auto").tag(String?.none)
                        ForEach(store.agents) { agent in
                            Text(agent.name).tag(Optional(agent.role))
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                }

                // Priority
                HStack {
                    Text("Priority")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.ancMuted)
                        .frame(width: 70, alignment: .leading)
                    Picker("", selection: $priority) {
                        ForEach(TaskPriority.allCases, id: \.self) { p in
                            HStack {
                                Text(priorityGlyph(p.rawValue))
                                Text(p.displayName)
                            }
                            .tag(p.rawValue)
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                }

                // Project
                HStack {
                    Text("Project")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.ancMuted)
                        .frame(width: 70, alignment: .leading)
                    Picker("", selection: $selectedProject) {
                        Text("None").tag(String?.none)
                        ForEach(store.projects) { proj in
                            Text(proj.name).tag(Optional(proj.id))
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                }
            }
            .padding(16)

            Spacer()

            Divider()

            // Actions
            HStack {
                Spacer()
                Button("Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)

                Button("Create") {
                    createTask()
                }
                .buttonStyle(.borderedProminent)
                .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || isCreating)
                .keyboardShortcut(.defaultAction)
            }
            .padding(16)
        }
        .frame(width: 480, height: 440)
    }

    private func createTask() {
        isCreating = true
        let trimmedTitle = title.trimmingCharacters(in: .whitespaces)
        let trimmedDesc = description.trimmingCharacters(in: .whitespaces)
        Task {
            await store.createTask(
                title: trimmedTitle,
                description: trimmedDesc.isEmpty ? nil : trimmedDesc,
                assignee: selectedAgent,
                priority: priority,
                projectId: selectedProject
            )
            dismiss()
        }
    }
}
