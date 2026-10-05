const UNSPEAKABLE = ".chat-markdown-codeblock, pre, hr, button";

export function markdownSpeechText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>+|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*`~]+/g, "")
    .trim();
}

export function renderedSpeechText(rendered: Element) {
  const clone = rendered.cloneNode(true);
  if (!(clone instanceof Element)) return "";
  for (const node of clone.querySelectorAll(UNSPEAKABLE)) node.remove();
  for (const line of clone.querySelectorAll("li, p, h1, h2, h3, h4, h5, h6, tr, br"))
    line.after("\n");
  return clone.textContent?.trim() ?? "";
}
