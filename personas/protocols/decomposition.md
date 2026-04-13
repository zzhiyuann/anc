# Task Decomposition Protocol

## When to Decompose

Decompose a task into sub-tasks when:

- The task involves **3+ distinct deliverables** (e.g., backend + frontend + tests)
- The description is long and covers **multiple independent concerns**
- You find yourself thinking "I need to do X first, then Y, then Z" where X/Y/Z are non-trivial
- The task crosses **multiple systems or codebases**
- Estimated effort exceeds **2 hours of focused work**

## How to Decompose

Use the ANC SDK to create sub-tasks:

```bash
anc create-sub $ANC_TASK_ID "Sub-task title" "Clear description of scope"
```

Each sub-task should:
- Be **independently completable** (no circular dependencies between sub-tasks)
- Have a **clear definition of done**
- Take **30-90 minutes** of focused work
- Include enough context to work without reading the parent

## When NOT to Decompose

Do NOT decompose when:
- The task is a single focused change (bug fix, config update, simple feature)
- Sub-tasks would be trivially small (< 10 minutes each)
- The work is inherently sequential with no parallelism benefit
- You are already a sub-task (avoid recursive decomposition unless truly needed)

## After Decomposition

1. Update the parent task with a plan comment listing the sub-tasks
2. Start working on sub-tasks in dependency order
3. The system will automatically notify you when sub-tasks complete (feedback loop)
4. Once all sub-tasks are done, synthesize results and complete the parent
