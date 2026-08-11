import { getTool, hubUrl } from "../registry.js";

/**
 * The slim top bar shared by every tool page: a link back to the hub plus the
 * current tool's icon and name.
 *
 * @param {string} toolId  id of the tool, as listed in the registry
 * @returns {HTMLElement}
 */
export function createHeader(toolId) {
  const tool = getTool(toolId);
  const name = tool ? tool.name : "Tool";

  const header = document.createElement("header");
  header.className = "site-header";

  const inner = document.createElement("div");
  inner.className = "site-header__inner";

  const back = document.createElement("a");
  back.className = "site-header__back";
  back.href = hubUrl();
  back.textContent = "← All tools";

  const title = document.createElement("h1");
  title.className = "site-header__title";

  if (tool?.icon) {
    const icon = document.createElement("span");
    icon.className = "site-header__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = tool.icon;
    title.append(icon);
  }

  title.append(document.createTextNode(name));
  inner.append(back, title);
  header.append(inner);

  return header;
}

/**
 * Convenience for tool pages: mount the header into `#site-header` and set the
 * document title to "<Tool name> · Tool Hub".
 *
 * @param {string} toolId
 */
export function mountHeader(toolId) {
  const tool = getTool(toolId);
  const slot = document.getElementById("site-header");

  if (slot) slot.replaceWith(createHeader(toolId));
  if (tool) document.title = `${tool.name} · Tool Hub`;
}
