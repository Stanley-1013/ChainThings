export interface TaskEntry {
  id: string;
  content: string;
  importance: number;
  due_date: string | null;
  source_type: string;
  source_id: string | null;
  created_at: string;
}

export interface MeetingNote {
  id: string;
  title: string | null;
  content: string | null;
  metadata: {
    keyPoints?: string[];
    actionItems?: Array<{ task: string; priority?: string }>;
    recap?: string;
    summary?: string;
    source?: string;
    duration?: string | number;
  };
  created_at: string;
}
