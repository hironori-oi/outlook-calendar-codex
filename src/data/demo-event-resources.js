const resourcesByEvent = {
  1: ["me"],
  2: ["me"],
  3: ["me", "sato", "suzuki", "chen", "hikari"],
  4: ["me", "suzuki"],
  5: ["suzuki", "studio"],
  6: ["sato"],
  7: ["me", "sato", "suzuki", "chen", "hikari"],
  8: ["me"],
  9: ["chen", "hikari"],
  10: ["suzuki"],
  11: ["me"],
  12: ["me", "sato", "suzuki", "chen"],
  13: ["me", "nagisa"],
  14: ["chen"],
  15: ["me", "sato", "suzuki", "chen"],
  16: ["me", "sato", "sora"],
  17: ["me", "sato", "suzuki", "chen"],
  18: ["me", "yamada", "tanaka", "nagisa"],
  19: ["me", "yamada", "tanaka"],
  20: ["me", "yamada", "tanaka", "sora"],
  21: ["me", "yamada", "tanaka", "nagisa"],
  22: ["yamada", "tanaka"],
  23: ["me", "yamada", "tanaka", "sora"],
  24: ["me", "watanabe", "ito", "kobayashi", "sato", "suzuki", "chen", "yamada"],
  25: ["me", "watanabe", "ito", "kobayashi"],
  26: ["me", "watanabe", "ito", "kobayashi", "sato"],
  27: ["me", "watanabe", "ito", "kobayashi", "sato", "suzuki"],
  28: ["me", "watanabe", "ito", "kobayashi", "sato", "suzuki", "chen", "yamada", "nagisa"],
  29: ["me", "watanabe", "ito", "kobayashi", "sato", "suzuki"],
};

export const DEMO_EVENT_RESOURCES = Object.freeze(Object.fromEntries(
  Object.entries(resourcesByEvent).map(([eventId, resourceIds]) => [eventId, Object.freeze([...resourceIds])]),
));

export function withDemoEventResources(event) {
  const resourceIds = DEMO_EVENT_RESOURCES[event.id];
  if (!resourceIds) throw new Error(`デモ予定 ${event.id} のリソース割当がありません`);
  return { ...event, resourceIds: [...resourceIds] };
}
