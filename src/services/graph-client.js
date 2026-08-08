const DEFAULT_BASE_URL = "https://graph.microsoft.com/v1.0";
const SCHEDULE_CHUNK_SIZE = 20;

export class GraphHttpError extends Error {
  constructor({ status, statusText, body, url, method }) {
    const detail = getErrorMessage(body);
    const statusLabel = [status, statusText].filter(Boolean).join(" ");
    super(`Microsoft Graph request failed (${statusLabel})${detail ? `: ${detail}` : ""}`);
    this.name = "GraphHttpError";
    this.status = status;
    this.body = body;
    this.url = url;
    this.method = method;
  }
}

/**
 * Creates a Microsoft Graph client whose authentication and transport are
 * supplied by the host. Access tokens are requested per HTTP call and are
 * never retained by this client.
 */
export function createGraphClient({
  fetchImpl = globalThis.fetch,
  accessTokenProvider,
  baseUrl = DEFAULT_BASE_URL,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function");
  }
  if (typeof accessTokenProvider !== "function") {
    throw new TypeError("accessTokenProvider must be a function");
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const graphOrigin = new URL(normalizedBaseUrl).origin;

  function resolveGraphUrl(target) {
    if (typeof target !== "string" || !target.trim()) {
      throw new TypeError("A Graph request URL is required");
    }

    const value = target.trim();
    const resolved = /^https?:\/\//i.test(value)
      ? new URL(value)
      : new URL(value.replace(/^\/+/, ""), `${normalizedBaseUrl}/`);

    // nextLink and deltaLink are opaque Graph URLs. Do not forward a bearer
    // token if an unexpected host is ever returned or supplied.
    if (resolved.origin !== graphOrigin) {
      throw new TypeError("Refusing to send a Graph access token to another origin");
    }

    return resolved.toString();
  }

  async function request(target, init = {}) {
    const url = resolveGraphUrl(target);
    const method = String(init.method || "GET").toUpperCase();
    const accessToken = await accessTokenProvider();
    if (typeof accessToken !== "string" || !accessToken.trim()) {
      throw new TypeError("accessTokenProvider returned an empty access token");
    }

    const response = await fetchImpl(url, {
      ...init,
      method,
      headers: {
        Accept: "application/json",
        ...(init.headers || {}),
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const body = await readResponseBody(response);

    if (!response.ok) {
      throw new GraphHttpError({
        status: response.status,
        statusText: response.statusText,
        body,
        url,
        method,
      });
    }

    return body;
  }

  async function getCollection(target) {
    const values = [];
    let nextLink = target;

    while (nextLink) {
      const page = await request(nextLink);
      assertCollectionResponse(page);
      values.push(...page.value);
      nextLink = page["@odata.nextLink"] || null;
    }

    return values;
  }

  return {
    async syncUsersDelta(deltaLink) {
      const users = [];
      let nextLink = deltaLink || "users/delta?$select=id,displayName,givenName,surname,mail,userPrincipalName,department,jobTitle,officeLocation,accountEnabled";
      let finalDeltaLink = null;

      while (nextLink) {
        const page = await request(nextLink);
        assertCollectionResponse(page);
        users.push(...page.value.map(mapUser));
        finalDeltaLink = page["@odata.deltaLink"] || finalDeltaLink;
        nextLink = page["@odata.nextLink"] || null;
      }

      return { users, deltaLink: finalDeltaLink };
    },

    async listRooms() {
      const roomDtos = await getCollection("places/microsoft.graph.room");
      return roomDtos.map(mapRoom);
    },

    async getSchedule({ emails, start, end, timeZone }) {
      if (!Array.isArray(emails)) {
        throw new TypeError("emails must be an array");
      }
      if (typeof timeZone !== "string" || !timeZone.trim()) {
        throw new TypeError("timeZone is required");
      }
      const startTime = toGraphDateTimeTimeZone(start, timeZone, "start");
      const endTime = toGraphDateTimeTimeZone(end, timeZone, "end");
      assertScheduleRange(startTime, endTime);

      const schedules = [];
      for (let index = 0; index < emails.length; index += SCHEDULE_CHUNK_SIZE) {
        const chunk = emails.slice(index, index + SCHEDULE_CHUNK_SIZE);
        if (!chunk.length) continue;

        const page = await request("me/calendar/getSchedule", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Prefer: `outlook.timezone="${escapeHeaderValue(timeZone)}"`,
          },
          body: JSON.stringify({
            schedules: chunk,
            startTime,
            endTime,
          }),
        });
        assertCollectionResponse(page);
        schedules.push(...page.value.map(mapSchedule));
      }

      return schedules;
    },

    async getCalendarView({ userId, start, end }) {
      if (typeof userId !== "string" || !userId.trim()) {
        throw new TypeError("userId is required");
      }

      const ownerPath = userId === "me"
        ? "me"
        : `users/${encodeURIComponent(userId)}`;
      const query = new URLSearchParams({
        startDateTime: toQueryDateTime(start, "start"),
        endDateTime: toQueryDateTime(end, "end"),
      });
      const eventDtos = await getCollection(`${ownerPath}/calendarView?${query}`);
      return eventDtos.map(mapEvent);
    },

    async createEvent({ event, transactionId }) {
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        throw new TypeError("event is required");
      }
      if (typeof transactionId !== "string" || !transactionId.trim()) {
        throw new TypeError("transactionId is required");
      }

      const created = await request("me/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toGraphEvent(event, transactionId)),
      });
      return mapEvent(created);
    },
  };
}

function normalizeBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw new TypeError("baseUrl must be a non-empty URL");
  }
  const parsed = new URL(baseUrl);
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/+$/, "");
}

async function readResponseBody(response) {
  if (!response || typeof response.text !== "function") {
    throw new TypeError("fetchImpl must return a Response-compatible object");
  }
  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getErrorMessage(body) {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return "";
  return body.error?.message || body.message || "";
}

function assertCollectionResponse(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.value)) {
    throw new TypeError("Microsoft Graph returned an invalid collection response");
  }
}

function escapeHeaderValue(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

function toGraphDateTimeTimeZone(value, fallbackTimeZone, label) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError(`${label} must be a valid date`);
    return { dateTime: value.toISOString(), timeZone: "UTC" };
  }
  if (typeof value === "string" && value.trim()) {
    return { dateTime: value, timeZone: fallbackTimeZone };
  }
  if (value && typeof value === "object" && typeof value.dateTime === "string") {
    return {
      dateTime: value.dateTime,
      timeZone: value.timeZone || fallbackTimeZone,
    };
  }
  throw new TypeError(`${label} must be a date-time string or object`);
}

function toQueryDateTime(value, label) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError(`${label} must be a valid date`);
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && typeof value.dateTime === "string") {
    return value.dateTime;
  }
  throw new TypeError(`${label} must be a date-time string or Date`);
}

function assertScheduleRange(start, end) {
  const startMs = Date.parse(start.dateTime);
  const endMs = Date.parse(end.dateTime);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new TypeError("start and end must contain valid date-time values");
  }
  if (endMs <= startMs) throw new RangeError("end must be later than start");
  if (endMs - startMs >= 62 * 24 * 60 * 60 * 1000) {
    throw new RangeError("getSchedule range must be shorter than 62 days");
  }
}

function mapUser(dto) {
  const deleted = Boolean(dto?.["@removed"]);
  return {
    id: dto?.id || "",
    name: dto?.displayName || "",
    givenName: dto?.givenName || "",
    surname: dto?.surname || "",
    email: dto?.mail || dto?.userPrincipalName || "",
    department: dto?.department || "",
    role: dto?.jobTitle || "",
    officeLocation: dto?.officeLocation || "",
    active: !deleted && dto?.accountEnabled !== false,
    deleted,
  };
}

function mapRoom(dto) {
  return {
    id: dto?.id || dto?.placeId || "",
    name: dto?.displayName || "",
    email: dto?.emailAddress || "",
    capacity: Number.isFinite(dto?.capacity) ? dto.capacity : null,
    location: {
      building: dto?.building?.displayName || dto?.building || null,
      floorNumber: Number.isFinite(dto?.floorNumber) ? dto.floorNumber : null,
      floorLabel: dto?.floorLabel || null,
      label: dto?.label || null,
    },
    equipment: {
      audio: dto?.audioDeviceName || null,
      video: dto?.videoDeviceName || null,
      display: dto?.displayDeviceName || null,
    },
    wheelchairAccessible: dto?.isWheelChairAccessible ?? null,
    tags: Array.isArray(dto?.tags) ? [...dto.tags] : [],
  };
}

function mapSchedule(dto) {
  return {
    resourceEmail: dto?.scheduleId || "",
    availability: dto?.availabilityView || "",
    blocks: Array.isArray(dto?.scheduleItems)
      ? dto.scheduleItems.map((item) => ({
          status: item?.status || "unknown",
          title: item?.isPrivate ? null : item?.subject || null,
          location: item?.isPrivate ? null : item?.location || null,
          private: Boolean(item?.isPrivate),
          start: mapDateTime(item?.start),
          end: mapDateTime(item?.end),
        }))
      : [],
  };
}

function mapEvent(dto) {
  if (!dto || typeof dto !== "object") {
    throw new TypeError("Microsoft Graph returned an invalid event response");
  }
  return {
    id: dto.id || "",
    title: dto.subject || "予定あり",
    start: mapDateTime(dto.start),
    end: mapDateTime(dto.end),
    allDay: Boolean(dto.isAllDay),
    cancelled: Boolean(dto.isCancelled),
    availability: dto.showAs || "unknown",
    sensitivity: dto.sensitivity || "normal",
    location: dto.location?.displayName || null,
    organizer: mapEmailIdentity(dto.organizer?.emailAddress),
    attendees: Array.isArray(dto.attendees)
      ? dto.attendees.map((attendee) => ({
          ...mapEmailIdentity(attendee?.emailAddress),
          type: attendee?.type || "required",
          response: attendee?.status?.response || "none",
        }))
      : [],
    onlineMeetingUrl: dto.onlineMeeting?.joinUrl || dto.onlineMeetingUrl || null,
    webUrl: dto.webLink || null,
    version: dto.changeKey || null,
  };
}

function mapDateTime(value) {
  if (!value || typeof value !== "object") return null;
  return {
    dateTime: value.dateTime || "",
    timeZone: value.timeZone || "UTC",
  };
}

function mapEmailIdentity(value) {
  if (!value || typeof value !== "object") return null;
  return {
    name: value.name || "",
    email: value.address || "",
  };
}

function toGraphEvent(event, transactionId) {
  const graphEvent = {
    subject: event.title || "",
    start: toEventDateTime(event.start, "event.start"),
    end: toEventDateTime(event.end, "event.end"),
    transactionId,
  };

  const body = mapEventBody(event);
  if (body) graphEvent.body = body;

  const locationName = typeof event.location === "string"
    ? event.location
    : event.location?.name;
  if (locationName) graphEvent.location = { displayName: locationName };

  if (Array.isArray(event.attendees)) {
    graphEvent.attendees = event.attendees.map((attendee) => {
      if (!attendee || typeof attendee.email !== "string" || !attendee.email.trim()) {
        throw new TypeError("Each attendee must have an email");
      }
      return {
        emailAddress: {
          address: attendee.email,
          ...(attendee.name ? { name: attendee.name } : {}),
        },
        type: attendee.type || "required",
      };
    });
  }

  copyIfDefined(graphEvent, event, "isOnlineMeeting");
  copyIfDefined(graphEvent, event, "onlineMeetingProvider");
  copyIfDefined(graphEvent, event, "showAs");
  copyIfDefined(graphEvent, event, "sensitivity");
  copyIfDefined(graphEvent, event, "importance");
  if (Array.isArray(event.categories)) graphEvent.categories = [...event.categories];

  return graphEvent;
}

function toEventDateTime(value, label) {
  if (!value || typeof value !== "object" || typeof value.dateTime !== "string" || !value.dateTime) {
    throw new TypeError(`${label} must include dateTime and timeZone`);
  }
  if (typeof value.timeZone !== "string" || !value.timeZone) {
    throw new TypeError(`${label} must include dateTime and timeZone`);
  }
  return { dateTime: value.dateTime, timeZone: value.timeZone };
}

function mapEventBody(event) {
  if (typeof event.description === "string") {
    return {
      contentType: event.descriptionFormat === "html" ? "HTML" : "Text",
      content: event.description,
    };
  }
  if (event.body && typeof event.body === "object" && typeof event.body.content === "string") {
    return {
      contentType: String(event.body.contentType || "Text").toLowerCase() === "html" ? "HTML" : "Text",
      content: event.body.content,
    };
  }
  return null;
}

function copyIfDefined(target, source, property) {
  if (source[property] !== undefined) target[property] = source[property];
}
