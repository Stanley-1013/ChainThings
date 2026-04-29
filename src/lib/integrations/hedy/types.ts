/**
 * Hedy.ai API types — based on OpenAPI spec at https://api.hedy.bot/v1/docs
 * REST API uses snake_case (webhook payloads use camelCase — see types in webhook handler).
 */

export interface HedyTopic {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
}

export interface HedyHighlight {
  id: string;
  sessionId: string;
  title?: string | null;
  aiInsight?: string | null;
  quote?: string | null;
  createdAt?: string;
}

export interface HedyTodo {
  id: string;
  sessionId: string;
  text: string;
  dueDate?: string | null;
  completed?: boolean;
  createdAt?: string;
}

export interface HedySession {
  sessionId: string;
  title?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  duration?: number | null;
  session_type?: string | null;
  transcript?: string | null;
  cleaned_transcript?: string | null;
  conversations?: unknown;
  meeting_minutes?: string | null;
  recap?: string | null;
  session_notes?: unknown;
  user_todos?: HedyTodo[] | null;
  highlights?: HedyHighlight[] | null;
  topic?: HedyTopic | null;
}

export interface HedyUser {
  id: string;
  email?: string;
  name?: string;
  pro?: boolean;
  cloudSyncEnabled?: boolean;
}

export interface HedyRegisteredWebhook {
  webhookId: string;
  url: string;
  events: string[];
  secret: string;
  active?: boolean;
}

export interface HedyPagination {
  hasMore: boolean;
  next?: string | null;
  total?: number;
}

export interface HedyListResponse<T> {
  success: boolean;
  data: T[];
  pagination?: HedyPagination;
}

export interface HedySingleResponse<T> {
  success: boolean;
  data: T;
}

export class HedyApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "HedyApiError";
  }
}
