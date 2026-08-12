import test from "node:test";
import assert from "node:assert/strict";

import {
  dayResourcesForSpace,
  eventVisibleInViewSet,
  lensModeForSpace,
  visiblePersonIds,
} from "../src/domain/calendar-view.js";
import { DEMO_EVENT_RESOURCES, withDemoEventResources } from "../src/data/demo-event-resources.js";

const people = {
  me: { name: "加藤 浩", short: "加", department: "事業推進室", color: "navy" },
  sato: { name: "佐藤 美咲", short: "佐", department: "プロダクト本部 / 企画", color: "blue" },
  suzuki: { name: "鈴木 健太", short: "鈴", department: "デザイン本部 / UX", color: "gold" },
};

const rooms = {
  hikari: { name: "HIKARI 12F", capacity: 8, equipment: "Teams" },
  sora: { name: "SORA 12F", capacity: 6, equipment: "モニター" },
};

test("visible people excludes only members hidden in the current view set", () => {
  const space = { people: ["me", "sato", "suzuki"], hiddenPeople: ["sato", "outsider"] };
  assert.deepEqual(visiblePersonIds(space, people), ["me", "suzuki"]);
});

test("an event follows shared resource IDs instead of its original space", () => {
  const event = { space: "product", resourceIds: ["sato"] };
  const anotherSpace = { people: ["me", "sato"], hiddenPeople: [], rooms: [] };

  assert.equal(eventVisibleInViewSet(event, anotherSpace, people, rooms), true);
  anotherSpace.hiddenPeople = ["sato"];
  assert.equal(eventVisibleInViewSet(event, anotherSpace, people, rooms), false);
});

test("explicit resource IDs are authoritative and an empty list never falls back to every member", () => {
  const space = { people: ["me", "sato", "suzuki"], hiddenPeople: [], rooms: ["hikari"] };
  const unknown = { owner: "加藤 浩", room: "HIKARI 12F", resourceIds: [] };
  const explicitOther = { owner: "加藤 浩", resourceIds: ["outside"] };

  assert.equal(eventVisibleInViewSet(unknown, space, people, rooms), false);
  assert.equal(eventVisibleInViewSet(explicitOther, space, people, rooms), false);
});

test("day resources retain every selected room when every person is off", () => {
  const space = {
    people: ["me", "sato"],
    hiddenPeople: ["me", "sato"],
    rooms: ["hikari", "sora"],
  };

  assert.deepEqual(dayResourcesForSpace(space, people, rooms).map(({ id, type }) => ({ id, type })), [
    { id: "hikari", type: "room" },
    { id: "sora", type: "room" },
  ]);
  assert.equal(eventVisibleInViewSet({ resourceIds: ["sora"] }, space, people, rooms), true);
  assert.equal(eventVisibleInViewSet({ resourceIds: ["me"] }, space, people, rooms), false);
});

test("lens mode distinguishes current, saved, and empty membership", () => {
  const space = { people: ["me", "sato", "suzuki"], hiddenPeople: [], rooms: [] };
  assert.equal(lensModeForSpace(space, people), "current");
  space.hiddenPeople = ["sato"];
  assert.equal(lensModeForSpace(space, people), "saved");
  space.hiddenPeople = ["me", "sato", "suzuki"];
  assert.equal(lensModeForSpace(space, people), "empty");
});

test("every demo event has a known resource assignment and private events are scoped", () => {
  const knownResources = new Set([
    "me", "sato", "suzuki", "chen", "yamada", "tanaka", "watanabe", "ito", "kobayashi",
    "hikari", "nagisa", "sora", "asahi", "studio",
  ]);
  assert.deepEqual(Object.keys(DEMO_EVENT_RESOURCES).map(Number), Array.from({ length: 29 }, (_, index) => index + 1));
  Object.values(DEMO_EVENT_RESOURCES).flat().forEach((resourceId) => assert.ok(knownResources.has(resourceId), resourceId));

  const memberships = {
    product: ["me", "sato", "suzuki", "chen"],
    sales: ["me", "watanabe", "ito", "kobayashi", "sato", "suzuki", "chen", "yamada"],
  };
  const privateEvents = [
    { id: 2, space: "product" },
    { id: 6, space: "product" },
    { id: 10, space: "product" },
    { id: 11, space: "product" },
    { id: 14, space: "product" },
    { id: 25, space: "sales" },
    { id: 29, space: "sales" },
  ].map(withDemoEventResources);

  privateEvents.forEach((event) => {
    const assignedPeople = event.resourceIds.filter((resourceId) => memberships[event.space].includes(resourceId));
    assert.ok(assignedPeople.length < memberships[event.space].length, `event ${event.id}`);
  });
});
