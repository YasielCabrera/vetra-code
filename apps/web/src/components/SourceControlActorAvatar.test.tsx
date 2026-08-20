import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SourceControlActorAvatar } from "./SourceControlActorAvatar";

describe("SourceControlActorAvatar", () => {
  it("renders the host-provided avatar", () => {
    const markup = renderToStaticMarkup(
      <SourceControlActorAvatar
        actor={{
          login: "octocat",
          avatarUrl: "https://github.com/octocat.png?size=80",
        }}
      />,
    );

    expect(markup).toContain('<img aria-hidden="true"');
    expect(markup).toContain('src="https://github.com/octocat.png?size=80"');
  });

  it("uses an initial when no avatar is available", () => {
    const markup = renderToStaticMarkup(
      <SourceControlActorAvatar actor={{ login: "octocat", avatarUrl: null }} />,
    );

    expect(markup).not.toContain("<img");
    expect(markup).toContain(">O</span>");
  });

  it("uses a generic avatar when the host has no actor", () => {
    const markup = renderToStaticMarkup(<SourceControlActorAvatar actor={null} />);

    expect(markup).not.toContain("<img");
    expect(markup).toContain(">G</span>");
  });
});
