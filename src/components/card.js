import { toolUrl } from "../registry.js";

/**
 * A single tool card for the landing grid. The whole card is one link, so it
 * is clickable everywhere and reachable with the keyboard for free.
 *
 * @param {{id: string, name: string, description: string, icon: string, path: string}} tool
 * @returns {HTMLAnchorElement}
 */
export function createCard(tool) {
  const card = document.createElement("a");
  card.className = "tool-card";
  card.href = toolUrl(tool);

  const icon = document.createElement("span");
  icon.className = "tool-card__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = tool.icon ?? "🔧";

  const name = document.createElement("h2");
  name.className = "tool-card__name";
  name.textContent = tool.name;

  const description = document.createElement("p");
  description.className = "tool-card__description";
  description.textContent = tool.description;

  card.append(icon, name, description);
  return card;
}
