import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { TasksPage } from "@/components/tasks/tasks-page";
import { loadTasks, type TaskSearchParams } from "@/lib/crm/tasks";

export const metadata = { title: "Tasks" };

export default async function TasksRoute({ searchParams }: { searchParams: Promise<TaskSearchParams> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <TasksPage data={await loadTasks(user.id, await searchParams)} />;
}
