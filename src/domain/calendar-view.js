function list(value) {
  return Array.isArray(value) ? value : [];
}

export function hiddenPersonIds(space) {
  const members = new Set(list(space?.people));
  return new Set(list(space?.hiddenPeople).filter((personId) => members.has(personId)));
}

export function visiblePersonIds(space, peopleById = {}) {
  const hidden = hiddenPersonIds(space);
  return list(space?.people).filter((personId) => peopleById[personId] && !hidden.has(personId));
}

export function eventVisibleInViewSet(event, space, peopleById = {}, roomsById = {}) {
  if (!space || event?.status === "draft") return false;

  const visiblePeople = new Set(visiblePersonIds(space, peopleById));
  const selectedRooms = new Set(list(space.rooms).filter((roomId) => roomsById[roomId]));

  if (Array.isArray(event?.resourceIds)) {
    return event.resourceIds.some((resourceId) => visiblePeople.has(resourceId) || selectedRooms.has(resourceId));
  }

  const personMatch = [...visiblePeople].some((personId) => event?.owner?.includes(peopleById[personId].name));
  const roomMatch = [...selectedRooms].some((roomId) => event?.room === roomsById[roomId].name);
  return personMatch || roomMatch;
}

export function eventMatchesDayResource(event, resource, peopleById = {}, roomsById = {}) {
  if (!resource) return false;
  if (Array.isArray(event?.resourceIds)) return event.resourceIds.includes(resource.id);
  if (resource.type === "room") return Boolean(roomsById[resource.id] && event?.room === roomsById[resource.id].name);
  return Boolean(peopleById[resource.id] && event?.owner?.includes(peopleById[resource.id].name));
}

export function dayResourcesForSpace(space, peopleById = {}, roomsById = {}) {
  const people = visiblePersonIds(space, peopleById).map((personId) => {
    const person = peopleById[personId];
    return {
      id: personId,
      type: "person",
      label: person.name,
      sub: personId === "me" ? "自分" : String(person.department || "").split(" / ").at(-1),
      color: person.color,
      short: person.short,
    };
  });
  const rooms = list(space?.rooms).filter((roomId) => roomsById[roomId]).map((roomId) => {
    const room = roomsById[roomId];
    return {
      id: roomId,
      type: "room",
      label: room.name,
      sub: `${room.capacity}名・${room.equipment}`,
      color: "",
      short: "",
    };
  });
  return [...people, ...rooms];
}

export function lensModeForSpace(space, peopleById = {}) {
  const total = list(space?.people).filter((personId) => peopleById[personId]).length;
  const visible = visiblePersonIds(space, peopleById).length;
  if (!visible) return "empty";
  return visible === total ? "current" : "saved";
}
