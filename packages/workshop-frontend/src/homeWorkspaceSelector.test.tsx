// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomeWorkspaceSelector, { NEW_WORKSPACE_TARGET } from "./components/HomeWorkspaceSelector";

vi.mock("@cloudflare/kumo", () => ({
  DropdownMenu: Object.assign(
    ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    {
      Trigger: ({ render }: { render: React.ReactElement }) => render,
      Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
      Item: ({
        children,
        onClick,
      }: {
        children: React.ReactNode;
        onClick?: () => void;
      }) => (
        <button type="button" onClick={onClick}>
          {children}
        </button>
      ),
    },
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sampleWorkspaces = [
  {
    id: "ws-a",
    title: "Alpha project",
    pinned: true,
    created: new Date("2026-01-01T00:00:00Z"),
    lastActive: new Date("2026-01-03T00:00:00Z"),
  },
  {
    id: "ws-b",
    title: "Beta notes",
    created: new Date("2026-01-02T00:00:00Z"),
    lastActive: new Date("2026-01-04T00:00:00Z"),
  },
];

describe("HomeWorkspaceSelector", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
  });

  it("defaults to new workspace and lists existing workspaces", async () => {
    const onChange = vi.fn<(target: string) => void>();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root!.render(
      <HomeWorkspaceSelector
        workspaces={sampleWorkspaces}
        loading={false}
        value={NEW_WORKSPACE_TARGET}
        onChange={onChange}
      />,
    ));

    expect(container.textContent).toContain("New workspace");
    expect(container.textContent).toContain("Alpha project");
    expect(container.textContent).toContain("Beta notes");
    expect(container.textContent).toContain("Favorites");
    expect(container.textContent).toContain("Recent");
  });

  it("shows the selected workspace title in the trigger", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root!.render(
      <HomeWorkspaceSelector
        workspaces={sampleWorkspaces}
        loading={false}
        value="ws-b"
        onChange={() => {}}
      />,
    ));

    expect(container.textContent).toContain("Beta notes");
  });
});
