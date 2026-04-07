import type { MeetingNote } from "./types";
import { MeetingItem } from "./meeting-item";
import { SectionTitle } from "./task-center";
import { Calendar, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface RecentMeetingsProps {
  meetings: MeetingNote[];
}

export function RecentMeetings({ meetings }: RecentMeetingsProps) {
  return (
    <div>
      <SectionTitle icon={Calendar} title="最近記錄" />
      <div className="space-y-2">
        {meetings.map((meeting) => (
          <MeetingItem key={meeting.id} meeting={meeting} />
        ))}
      </div>
      <Link href="/items" className="block text-center mt-3">
        <Button variant="link" size="sm" className="text-muted-foreground hover:text-primary text-xs">
          查看全部記錄 <ChevronRight className="h-3 w-3 ml-1" />
        </Button>
      </Link>
    </div>
  );
}
