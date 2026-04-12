import { api, ApiError } from "@/lib/api";
import { mockTaskFull } from "@/lib/mock-data";
import type { TaskFull } from "@/lib/types";
import { TaskDetailView } from "./task-detail-view";

// Always fetched at request time — task state is real-time.
export const dynamic = "force-dynamic";

async function loadTask(id: string): Promise<{ data: TaskFull; live: boolean }> {
  try {
    const data = await api.tasks.getFull(id);
    return { data, live: true };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // Real 404 — still render with mock so the page is explorable.
      return {
        data: { ...mockTaskFull, task: { ...mockTaskFull.task, id } },
        live: false,
      };
    }
    return {
      data: { ...mockTaskFull, task: { ...mockTaskFull.task, id } },
      live: false,
    };
  }
}

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data, live } = await loadTask(id);
  return <TaskDetailView taskId={id} initial={data} live={live} />;
}
