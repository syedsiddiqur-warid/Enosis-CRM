import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { StartTasks } from "@/components/tasks/start-tasks";
import { loadTaskQueue, type TaskSearchParams } from "@/lib/crm/tasks";

export const metadata = { title: "Start tasks" };

export default async function StartTasksRoute({ searchParams }: { searchParams: Promise<TaskSearchParams> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <StartTasks data={await loadTaskQueue(user.id, await searchParams)} />;
}
