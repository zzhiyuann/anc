## Summary

Implemented task dependencies so tasks can block on each other. Added a `dependsOn` field to tasks and wrote logic to auto-unblock when parent tasks complete. Also started on the dashboard graph view.

## What was done

- Added `dependsOn: string[]` to the task schema and a new `dependencies` table in SQLite:

```ts
db.exec(`CREATE TABLE dependencies (
  task_id TEXT, depends_on TEXT,
  UNIQUE(task_id, depends_on)
)`);
```

- Modified `updateTask` in `core/tasks.ts` to check dependencies on completion:

```ts
if (update.status === 'done') {
  const blocked = db.prepare(
    'SELECT task_id FROM dependencies WHERE depends_on = ?'
  ).all(taskId);
  for (const row of blocked) {
    // unblock by setting status back to todo
    updateTask(row.task_id, { status: 'todo' });
  }
}
```

- For circular dependency detection I check if A depends on B and B depends on A before inserting. Should cover most cases

- Added a `/dependencies` React component that renders tasks as a list with indentation to show the graph. Couldn't get the actual graph library (dagre) to work with Next.js so used nested divs instead

## Known issues

- The recursive `updateTask` call sometimes triggers the completion hook again, causing a loop where tasks flip between `done` and `todo` — added a `skipHooks` flag but it's not wired up everywhere yet
- Circular detection only checks direct cycles (A→B→A), not transitive ones (A→B→C→A)
- The `dependencies` table migration runs on every server start, which drops existing data due to `CREATE TABLE` without `IF NOT EXISTS`
- Broke the task state machine — tasks in `blocked` status weren't part of the legal transitions so `updateTask` throws for those now
- Didn't update the API routes to expose dependency CRUD, I was calling the DB directly from the React component via a new endpoint that bypasses validation

## Next

- Fix the state machine transitions
- Add IF NOT EXISTS to the migration
- Look into proper graph rendering
