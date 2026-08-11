import { tools } from "./registry.js";
import { createCard } from "./components/card.js";

/** Render the landing grid from the registry. */
function renderHub() {
  const grid = document.getElementById("tool-grid");
  if (!grid) return;

  grid.replaceChildren();

  if (tools.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No tools registered yet.";
    grid.append(empty);
    return;
  }

  grid.append(...tools.map(createCard));
}

renderHub();
