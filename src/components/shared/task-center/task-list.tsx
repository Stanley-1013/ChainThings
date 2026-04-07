import type { TaskEntry } from "./types";
import { TaskItem } from "./task-item";
import { SectionTitle } from "./task-center";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface TaskListProps {
  tasks: TaskEntry[];
  onDelete: (id: string) => Promise<void>;
  onUpdateDueDate: (id: string, dueDate: string | null) => Promise<void>;
  onAdd: () => void;
}

export function TaskList({ tasks, onDelete, onUpdateDueDate, onAdd }: TaskListProps) {
  return (
    <div>
      <SectionTitle icon={ClipboardList} title="待辦事項" />
      {tasks.length === 0 ? (
        <div className="text-center py-8">
          <ClipboardList className="h-10 w-10 mx-auto mb-2 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">目前沒有待辦事項</p>
          <Button variant="link" size="sm" onClick={onAdd} className="mt-1 text-xs">
            <Plus className="h-3 w-3 mr-1" />
            新增第一個待辦
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskItem key={task.id} task={task} onDelete={onDelete} onUpdateDueDate={onUpdateDueDate} />
          ))}
        </div>
      )}
    </div>
  );
}
