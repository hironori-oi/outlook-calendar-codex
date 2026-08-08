import assert from "node:assert/strict";
import test from "node:test";

import { createGraphClient, GraphHttpError } from "../src/services/graph-client.js";

function jsonResponse(body, { status = 200, statusText } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

test("syncUsersDelta follows every nextLink and returns the final deltaLink", async () => {
  const calls = [];
  let tokenRequestCount = 0;
  const nextLink = "https://graph.test/v1.0/users/delta?$skiptoken=page-2";
  const deltaLink = "https://graph.test/v1.0/users/delta?$deltatoken=next-sync";
  const responses = [
    jsonResponse({
      value: [{
        id: "user-1",
        displayName: "佐藤 美咲",
        mail: "misaki@example.jp",
        department: "プロダクト本部",
      }],
      "@odata.nextLink": nextLink,
    }),
    jsonResponse({
      value: [{ id: "user-2", "@removed": { reason: "deleted" } }],
      "@odata.deltaLink": deltaLink,
    }),
  ];
  const client = createGraphClient({
    baseUrl: "https://graph.test/v1.0",
    accessTokenProvider: async () => `token-${++tokenRequestCount}`,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return responses.shift();
    },
  });

  const result = await client.syncUsersDelta();

  assert.equal(result.deltaLink, deltaLink);
  assert.equal(result.users.length, 2);
  assert.deepEqual(result.users[0], {
    id: "user-1",
    name: "佐藤 美咲",
    givenName: "",
    surname: "",
    email: "misaki@example.jp",
    department: "プロダクト本部",
    role: "",
    officeLocation: "",
    active: true,
    deleted: false,
  });
  assert.equal(result.users[1].deleted, true);
  assert.equal("displayName" in result.users[0], false);
  assert.deepEqual(calls.map(({ url }) => url), [
    "https://graph.test/v1.0/users/delta?$select=id,displayName,givenName,surname,mail,userPrincipalName,department,jobTitle,officeLocation,accountEnabled",
    nextLink,
  ]);
  assert.equal(calls[0].init.headers.Authorization, "Bearer token-1");
  assert.equal(calls[1].init.headers.Authorization, "Bearer token-2");
  assert.equal(tokenRequestCount, 2, "a fresh token is requested for each HTTP call");
});

test("getSchedule sends no more than 20 email addresses in each request", async () => {
  const emails = Array.from({ length: 45 }, (_, index) => `person${index + 1}@example.jp`);
  const requestBodies = [];
  const preferences = [];
  const client = createGraphClient({
    baseUrl: "https://graph.test/v1.0",
    accessTokenProvider: async () => "schedule-token",
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://graph.test/v1.0/me/calendar/getSchedule");
      const body = JSON.parse(init.body);
      requestBodies.push(body);
      preferences.push(init.headers.Prefer);
      return jsonResponse({
        value: body.schedules.map((email) => ({
          scheduleId: email,
          availabilityView: "01",
          scheduleItems: [],
        })),
      });
    },
  });

  const result = await client.getSchedule({
    emails,
    start: "2026-08-10T09:00:00",
    end: "2026-08-10T18:00:00",
    timeZone: "Tokyo Standard Time",
  });

  assert.deepEqual(requestBodies.map(({ schedules }) => schedules.length), [20, 20, 5]);
  assert.deepEqual(requestBodies.flatMap(({ schedules }) => schedules), emails);
  assert.deepEqual(requestBodies[0].startTime, {
    dateTime: "2026-08-10T09:00:00",
    timeZone: "Tokyo Standard Time",
  });
  assert.ok(preferences.every((value) => value === 'outlook.timezone="Tokyo Standard Time"'));
  assert.equal(result.length, 45);
  assert.equal(result[0].resourceEmail, emails[0]);
  assert.equal("scheduleId" in result[0], false);
});

test("getSchedule rejects periods of 62 days or more before requesting a token", async () => {
  let tokenRequested = false;
  const client = createGraphClient({
    baseUrl: "https://graph.test/v1.0",
    accessTokenProvider: async () => {
      tokenRequested = true;
      return "unused";
    },
    fetchImpl: async () => {
      throw new Error("fetch should not be called");
    },
  });

  await assert.rejects(() => client.getSchedule({
    emails: ["person@example.jp"],
    start: "2026-01-01T00:00:00Z",
    end: "2026-03-04T00:00:00Z",
    timeZone: "UTC",
  }), /shorter than 62 days/);
  assert.equal(tokenRequested, false);
});

test("createEvent maps the domain event and includes transactionId", async () => {
  let captured;
  const client = createGraphClient({
    baseUrl: "https://graph.test/v1.0",
    accessTokenProvider: async () => "event-token",
    fetchImpl: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return jsonResponse({
        id: "event-1",
        subject: captured.body.subject,
        start: captured.body.start,
        end: captured.body.end,
        location: captured.body.location,
        attendees: captured.body.attendees,
        changeKey: "version-1",
      }, { status: 201 });
    },
  });

  const created = await client.createEvent({
    transactionId: "b3ef42f4-09d5-43f8-9774-e8a1e1aa4d02",
    event: {
      title: "プロジェクトレビュー",
      description: "次期リリースを確認します",
      start: { dateTime: "2026-08-11T15:00:00", timeZone: "Tokyo Standard Time" },
      end: { dateTime: "2026-08-11T16:00:00", timeZone: "Tokyo Standard Time" },
      location: "HIKARI 12F",
      attendees: [{ email: "misaki@example.jp", name: "佐藤 美咲", type: "required" }],
      isOnlineMeeting: true,
      onlineMeetingProvider: "teamsForBusiness",
    },
  });

  assert.equal(captured.url, "https://graph.test/v1.0/me/events");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.body.transactionId, "b3ef42f4-09d5-43f8-9774-e8a1e1aa4d02");
  assert.equal(captured.body.subject, "プロジェクトレビュー");
  assert.equal(captured.body.title, undefined);
  assert.deepEqual(captured.body.attendees[0], {
    emailAddress: { address: "misaki@example.jp", name: "佐藤 美咲" },
    type: "required",
  });
  assert.equal(created.id, "event-1");
  assert.equal(created.title, "プロジェクトレビュー");
  assert.equal(created.version, "version-1");
  assert.equal("subject" in created, false);
});

test("HTTP failures throw GraphHttpError with status and parsed body", async () => {
  const errorBody = {
    error: {
      code: "TooManyRequests",
      message: "Please retry later",
    },
  };
  const client = createGraphClient({
    baseUrl: "https://graph.test/v1.0",
    accessTokenProvider: async () => "error-token",
    fetchImpl: async () => jsonResponse(errorBody, {
      status: 429,
      statusText: "Too Many Requests",
    }),
  });

  await assert.rejects(
    client.listRooms(),
    (error) => {
      assert.ok(error instanceof GraphHttpError);
      assert.equal(error.status, 429);
      assert.deepEqual(error.body, errorBody);
      assert.equal(error.method, "GET");
      assert.match(error.message, /Please retry later/);
      return true;
    },
  );
});

test("listRooms and getCalendarView return domain models instead of Graph DTOs", async () => {
  const requests = [];
  const client = createGraphClient({
    baseUrl: "https://graph.test/v1.0",
    accessTokenProvider: async () => "mapping-token",
    fetchImpl: async (url) => {
      requests.push(url);
      if (url.includes("places/microsoft.graph.room")) {
        return jsonResponse({
          value: [{
            id: "room-1",
            displayName: "HIKARI 12F",
            emailAddress: "hikari@example.jp",
            capacity: 8,
            floorNumber: 12,
            videoDeviceName: "Teams Room",
          }],
        });
      }
      return jsonResponse({
        value: [{
          id: "event-2",
          subject: "企画レビュー",
          start: { dateTime: "2026-08-11T13:00:00", timeZone: "Tokyo Standard Time" },
          end: { dateTime: "2026-08-11T14:00:00", timeZone: "Tokyo Standard Time" },
          location: { displayName: "HIKARI 12F" },
        }],
      });
    },
  });

  const rooms = await client.listRooms();
  const events = await client.getCalendarView({
    userId: "misaki.sato@example.jp",
    start: "2026-08-10T00:00:00+09:00",
    end: "2026-08-15T00:00:00+09:00",
  });

  assert.equal(rooms[0].name, "HIKARI 12F");
  assert.equal(rooms[0].equipment.video, "Teams Room");
  assert.equal("displayName" in rooms[0], false);
  assert.equal(events[0].title, "企画レビュー");
  assert.equal(events[0].location, "HIKARI 12F");
  assert.equal("subject" in events[0], false);
  assert.match(requests[1], /users\/misaki\.sato%40example\.jp\/calendarView/);
  assert.match(requests[1], /startDateTime=2026-08-10T00%3A00%3A00%2B09%3A00/);
});
