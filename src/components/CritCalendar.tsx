import { useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { EventContentArg } from "@fullcalendar/core";
import { CalendarClock, ChevronLeft, ChevronRight, MapPin, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type CritEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  extendedProps: {
    agent: string;
    tutor: string;
    room: string;
    week: number;
    reason: string | null;
    color: number;
  };
};

// One accent per group: ANU gold first, then colours that stay distinct from it.
const COLORS = [
  { bar: "#be830e", bg: "#f5edde" },
  { bar: "#1a7f5a", bg: "#dff3ea" },
  { bar: "#2d6cdf", bg: "#e0ebfc" },
  { bar: "#b3261e", bg: "#fbe4e2" },
  { bar: "#7b3fb0", bg: "#ede2f7" },
  { bar: "#0f7c8a", bg: "#ddf1f4" },
];

function EventCard({ arg }: { arg: EventContentArg }) {
  const p = arg.event.extendedProps as CritEvent["extendedProps"];
  const c = COLORS[p.color % COLORS.length];
  const moved = p.reason !== null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="block h-full w-full cursor-pointer border-0 overflow-hidden rounded-md px-2 py-1 text-left text-xs leading-tight text-foreground"
          style={{
            background: `color-mix(in srgb, ${c.bar} 18%, var(--surface))`,
            borderLeft: `4px solid ${c.bar}`,
            outline: moved ? `2px dashed ${c.bar}` : undefined,
            outlineOffset: -2,
          }}
        >
          <strong className="block text-[0.8rem]">{arg.event.title}</strong>
          <span className="block">{arg.timeText}</span>
          {moved && <span className="italic">Rescheduled</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm">
        <div className="mb-2 flex items-start justify-between gap-2">
          <h3 className="m-0 text-base font-bold">{arg.event.title}</h3>
          {moved && <Badge>Rescheduled</Badge>}
        </div>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-muted-foreground">
          <li className="flex items-center gap-2">
            <CalendarClock className="size-4" /> Week {p.week} · {arg.timeText}
          </li>
          <li className="flex items-center gap-2">
            <User className="size-4" /> {p.tutor}
          </li>
          <li className="flex items-center gap-2">
            <MapPin className="size-4" /> {p.room}
          </li>
        </ul>
        {p.reason && <p className="mt-2 mb-0 rounded-md bg-accent p-2 italic">{p.reason}</p>}
        <a className="mt-3 inline-block font-semibold" href={`/#group-${p.agent}`}>
          Reschedule on the roster →
        </a>
      </PopoverContent>
    </Popover>
  );
}

export default function CritCalendar({
  events,
  initialDate,
  validStart,
  validEnd,
}: {
  events: CritEvent[];
  initialDate: string;
  validStart: string;
  validEnd: string;
}) {
  const ref = useRef<FullCalendar>(null);
  const [title, setTitle] = useState("");
  const api = () => ref.current?.getApi();

  return (
    <div className="crit-cal">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => api()?.today()}>
          Today
        </Button>
        <Button variant="ghost" size="icon" aria-label="Previous week" onClick={() => api()?.prev()}>
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Next week" onClick={() => api()?.next()}>
          <ChevronRight />
        </Button>
        {title && (
          <h2 className="m-0 text-xl font-semibold" aria-live="polite">
            {title}
          </h2>
        )}
      </div>
      <FullCalendar
        ref={ref}
        plugins={[timeGridPlugin]}
        initialView="timeGridWeek"
        initialDate={initialDate}
        validRange={{ start: validStart, end: validEnd }}
        headerToolbar={false}
        weekends={false}
        allDaySlot={false}
        nowIndicator
        slotMinTime="08:00:00"
        slotMaxTime="18:00:00"
        slotDuration="00:30:00"
        slotLabelFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        slotEventOverlap={false}
        height="auto"
        firstDay={1}
        events={events}
        eventContent={(arg) => <EventCard arg={arg} />}
        datesSet={(d) => setTitle(d.view.title)}
      />
    </div>
  );
}
