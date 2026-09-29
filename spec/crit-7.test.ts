import { beforeAll, describe, expect, inject, it } from "vitest";
import { createDirtyTracker, createReconnectGate } from "../src/lib/live-reload";
import { sessionDate } from "../src/lib/db";

// This week's brief: model a slice of a real ANU system, wired end to end,
// with a core flow that survives a reload. The roster's core flow is
// rescheduling a crit group's session for one teaching week; these tests
// assert the contracts that make that a real persisted change, not just a
// page that renders — the same shape as the starter's own guestbook.test.ts
// asserted for the demo it replaces.
const baseUrl = inject("baseUrl");

// Astro checks form POSTs carry a same-origin Origin header (CSRF
// protection); browsers send it automatically, a bare fetch doesn't.
const post = (path: string, body: URLSearchParams) =>
  fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { origin: baseUrl },
    body,
    redirect: "manual",
  });

describe("rescheduling a session", () => {
  const reason = `spec probe ${process.hrtime.bigint()}`;

  it("accepts a valid reschedule and redirects back to the roster", async () => {
    const res = await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "3", // baishi
        week: "8",
        day: "Thu",
        startTime: "11:00",
        endTime: "12:30",
        room: "",
        reason,
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });

  it("persists the reschedule: a fresh page load shows it", async () => {
    const res = await fetch(baseUrl);
    const html = await res.text();
    expect(html).toContain(reason);
    expect(html).toContain("Thu 11:00–12:30");
  });

  it("falls back to the group's own room when none is given", async () => {
    const html = await (await fetch(baseUrl)).text();
    expect(html).toContain("Marie Reay Building (155), Room 4.03");
  });

  it("broadcasts the change over the SSE stream", async () => {
    const stream = await fetch(new URL("/api/events", baseUrl));
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body?.getReader();
    if (!reader) throw new Error("no response body");

    await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "4", // dachi
        week: "8",
        day: "Thu",
        startTime: "13:00",
        endTime: "14:30",
        room: "",
        reason: "live probe",
      }),
    );

    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes("data: changed")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before the event arrived");
      received += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
  }, 10_000);
});

describe("rescheduling the same week twice", () => {
  // addException deletes any existing exception for the same (critGroupId,
  // week) before inserting the new one -- the schema's own unique
  // constraint on that pair would otherwise reject the second insert. This
  // is the "one exception per group per week" rule CLAUDE.md names, and had
  // no test of its own: a naive read of that constraint could just as
  // easily mean "reject a second reschedule," which is not what the code
  // does.
  it("replaces the earlier exception rather than duplicating or rejecting it", async () => {
    await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "6", // liuru
        week: "11",
        day: "Tue",
        startTime: "09:00",
        endTime: "10:00",
        room: "",
        reason: "first reschedule",
      }),
    );
    const res = await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "6",
        week: "11",
        day: "Fri",
        startTime: "13:00",
        endTime: "14:00",
        room: "",
        reason: "second reschedule",
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");

    const html = await (await fetch(baseUrl)).text();
    expect(html).not.toContain("first reschedule");
    expect(html).toContain("second reschedule");
    expect(html).toContain("Fri 13:00–14:00");
    // exactly one row for that group/week, not one for each reschedule
    expect(html.match(/second reschedule/g)?.length).toBe(1);
  });
});

describe("validation", () => {
  it("rejects a reason-free request without writing an exception", async () => {
    const res = await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "3",
        week: "5",
        day: "Thu",
        startTime: "09:00",
        endTime: "10:00",
        room: "",
        reason: "",
      }),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/^\/\?error=/);

    const html = await (await fetch(baseUrl)).text();
    // week 5's standing Wednesday slot should be untouched
    expect(html).not.toContain("Thu 09:00–10:00");
  });

  it("rejects an end time that isn't after the start time", async () => {
    const res = await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "3",
        week: "6",
        day: "Wed",
        startTime: "10:00",
        endTime: "09:00",
        room: "",
        reason: "bad range",
      }),
    );
    expect(res.headers.get("location")).toMatch(/^\/\?error=/);
  });

  it("rejects a weekend day", async () => {
    const res = await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "3",
        week: "6",
        day: "Sat",
        startTime: "10:00",
        endTime: "11:00",
        room: "",
        reason: "weekend",
      }),
    );
    expect(res.headers.get("location")).toMatch(/^\/\?error=/);
  });
});

describe("live-reload reconnect gate", () => {
  // The client's EventSource reconnects on its own after any drop -- a
  // network blip, or on Fly.io the machine auto-stopping while idle -- but
  // the in-memory bus keeps no backlog of what it missed. Verified live with
  // agent-browser too (killing and restarting the preview server mid-session
  // to simulate a Fly auto-stop/wake cycle, see memory/now.md); this covers
  // the gate's own decision in isolation, cheaper than a browser round trip.
  it("does not reload on the first connect", () => {
    const shouldReloadOnOpen = createReconnectGate();
    expect(shouldReloadOnOpen()).toBe(false);
  });

  it("reloads on every reconnect after the first", () => {
    const shouldReloadOnOpen = createReconnectGate();
    shouldReloadOnOpen();
    expect(shouldReloadOnOpen()).toBe(true);
    expect(shouldReloadOnOpen()).toBe(true);
  });
});

describe("sessionDate", () => {
  // CLAUDE.md's own rule: a session's date is derived from the week's
  // Monday, never stored. Every roster row on the page renders through
  // this function, but nothing had asserted the arithmetic itself --
  // only eyeballed the rendered result against the real calendar.
  it("returns the Monday itself for a Mon session", () => {
    expect(sessionDate("2026-07-27", "Mon")).toBe("2026-07-27");
  });

  it("offsets forward within the same week for a later weekday", () => {
    expect(sessionDate("2026-07-27", "Wed")).toBe("2026-07-29");
  });

  it("crosses a month boundary using a real seeded week", () => {
    // Week 8's Monday (2026-09-28); its Friday session falls in October.
    expect(sessionDate("2026-09-28", "Fri")).toBe("2026-10-02");
  });
});

describe("dirty tracker", () => {
  // A `location.reload()` from the SSE stream would silently wipe an
  // in-progress reschedule draft -- found live with agent-browser: filling
  // the reschedule form's reason field, triggering a genuine change from a
  // second tab, and watching the first tab's draft vanish on reload with no
  // warning. This is the gate that stops that: index.astro wires markDirty
  // to the reschedule form's own `input` event and checks isDirty before
  // reloading on either a "message" event or a post-first reconnect.
  it("starts clean and reports dirty once marked", () => {
    const dirty = createDirtyTracker();
    expect(dirty.isDirty()).toBe(false);
    dirty.markDirty();
    expect(dirty.isDirty()).toBe(true);
  });

  it("stays dirty across repeated checks and marks", () => {
    const dirty = createDirtyTracker();
    dirty.markDirty();
    dirty.markDirty();
    expect(dirty.isDirty()).toBe(true);
    expect(dirty.isDirty()).toBe(true);
  });

  // Found live the same way as the reload-vs-draft bug above: a tutor who
  // types into the reschedule form and then clears it back out (or the
  // browser autofills a default value they then remove) has nothing left
  // to lose, but a one-way dirty flag would leave this tab's live sync
  // broken for the rest of its life over a draft that no longer exists.
  it("goes clean again once marked clean", () => {
    const dirty = createDirtyTracker();
    dirty.markDirty();
    expect(dirty.isDirty()).toBe(true);
    dirty.markClean();
    expect(dirty.isDirty()).toBe(false);
  });

  // Found live the same way as the two bugs above: going clean stops
  // *future* reload attempts from being skipped, but a change that already
  // arrived while dirty (a reload skipped, the stale notice shown instead)
  // was never retried -- the tab sat on the stale notice until some
  // unrelated further change happened to arrive, or the tutor manually
  // refreshed. `notePendingReload` records that a reload was deferred;
  // `claimPendingReload` is what index.astro checks right after `markClean`
  // to fire that deferred reload immediately instead of waiting for one
  // that might never come.
  it("claims a pending reload once, after the deferring dirty state clears", () => {
    const dirty = createDirtyTracker();
    dirty.markDirty();
    dirty.notePendingReload();
    dirty.markClean();
    expect(dirty.claimPendingReload()).toBe(true);
    expect(dirty.claimPendingReload()).toBe(false);
  });

  it("has nothing pending when no reload was ever deferred", () => {
    const dirty = createDirtyTracker();
    dirty.markDirty();
    dirty.markClean();
    expect(dirty.claimPendingReload()).toBe(false);
  });
});

describe("cancelling a reschedule", () => {
  let exceptionId: string;

  beforeAll(async () => {
    await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "5", // yunlin
        week: "3",
        day: "Fri",
        startTime: "09:00",
        endTime: "10:00",
        room: "",
        reason: "to be cancelled",
      }),
    );
    const html = await (await fetch(baseUrl)).text();
    // the cancel form's action follows its exception's reason text in the
    // rendered <li>, so anchor the search there rather than assuming an id
    const match = html.match(/to be cancelled[^]*?\/api\/exceptions\/(\d+)\/cancel/);
    if (!match) throw new Error("could not find the exception's cancel form in the roster page");
    exceptionId = match[1];
  });

  it("reverts the week to the group's standing slot", async () => {
    const res = await post(`/api/exceptions/${exceptionId}/cancel`, new URLSearchParams());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");

    const html = await (await fetch(baseUrl)).text();
    expect(html).not.toContain("to be cancelled");
  });
});

describe("room clashes", () => {
  // Every standing slot shares one room, so a reschedule can land two
  // groups in the same room at the same time. The roster already knows
  // every session's room and time for every week; it should refuse to
  // double-book, and say who's already there.
  it("rejects a reschedule that overlaps another group in the same room", async () => {
    const res = await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "4", // dachi, standing Wed 10:30–12:00
        week: "10",
        day: "Wed",
        startTime: "09:30", // overlaps baishi's standing Wed 09:00–10:30
        endTime: "11:00",
        room: "", // falls back to Room 4.03, same as baishi
        reason: "clash probe",
      }),
    );
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location") ?? "");
    expect(location).toMatch(/^\/\?error=/);
    expect(location).toContain("Baishi");

    const html = await (await fetch(baseUrl)).text();
    expect(html).not.toContain("clash probe");
  });

  it("allows the same slot in a different room", async () => {
    const res = await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "4",
        week: "10",
        day: "Wed",
        startTime: "09:30",
        endTime: "11:00",
        room: "Marie Reay Building (155), Room 3.05",
        reason: "other room probe",
      }),
    );
    expect(res.headers.get("location")).toBe("/");
  });

  it("allows back-to-back sessions in the same room", async () => {
    const res = await post(
      "/api/exceptions",
      new URLSearchParams({
        critGroupId: "6", // liuru, standing Wed 15:30–17:00
        week: "12",
        day: "Wed",
        startTime: "12:00", // dachi ends 12:00 here
        endTime: "13:30",
        room: "",
        reason: "back-to-back probe",
      }),
    );
    expect(res.headers.get("location")).toBe("/");
  });
});
