# 05 — Builder workspace UI

## Reference-image interpretation

The supplied image uses a useful three-pane structure:

1. a persistent navigation rail for product areas and recent work;
2. a focused agent activity column with the composer at the bottom;
3. a large workbench showing Preview or Code, with run/publish controls above it.

The fork should adopt the information hierarchy, not copy branding or every control. Existing Vetra
features should remain where they improve the builder experience.

## Proposed desktop/web layout

```text
+------------------+---------------------------+--------------------------------------+
| Project rail     | Agent pane                | Project workbench                    |
|                  |                           |                                      |
| New project      | Project + thread header   | Preview | Code | Diff | Terminal    |
| Projects         | Messages                  |                                      |
| Threads          | Tool/approval activity    | Active surface                       |
| Integrations     |                           |                                      |
| Settings         | Composer                  | Run status            Publish       |
+------------------+---------------------------+--------------------------------------+
```

On narrower screens, the project rail collapses first and the workbench becomes a tab or overlay.
There is no mobile application requirement, but browser windows still need a usable narrow layout.

## Reuse map

| Builder need                       | Existing foundation                                    |
| ---------------------------------- | ------------------------------------------------------ |
| Project and thread navigation      | `AppSidebarLayout`, sidebar state and project grouping |
| Agent conversation                 | `components/chat` and orchestration atoms              |
| Composer and attachments           | existing chat composer                                 |
| Approval and input requests        | existing approval/input UI                             |
| Provider and model selection       | provider settings and composer controls                |
| Changes                            | existing diff/review modules                           |
| Files                              | existing file tree/read modules                        |
| Terminal                           | existing terminal manager and UI                       |
| Preview on desktop                 | existing Electron preview bridge and manager           |
| Command palette and shortcuts      | existing palette/keybinding modules                    |
| Connections and environment health | existing connection runtime/settings                   |

## New UI concepts

### Project rail

The primary entity should become the project, with threads nested or filterable inside it. The first
implementation can preserve current routing and derive the active project from the selected thread.
Do not perform a route and persistence migration merely to draw the new shell.

Actions:

- New project;
- select project;
- create/select/archive thread;
- open Integrations and Settings;
- see local versus managed environment status.

### Agent pane

Retain the full fidelity of existing orchestration rather than flattening it into decorative status
rows. The pane must continue to display:

- user and assistant messages;
- streaming state;
- tool activity;
- approvals;
- requested user input;
- interruptions and errors;
- provider/model/mode selection;
- attachments;
- turn completion and checkpoint/diff state.

The screenshot's concise activity rows can inspire styling, but must not hide actionable requests or
make pending work appear complete.

### Workbench

Start with tabs backed by existing capabilities:

- **Preview**: desktop preview adapter initially; hosted adapter after the managed proof.
- **Code**: file tree plus readable source view. A full code editor is deferred.
- **Diff**: existing turn/thread diff experience.
- **Terminal**: existing terminal experience.

The active workbench tab should be stable across thread navigation within the same project where
possible.

### Top bar

Display:

- project name;
- execution mode: Local or Managed;
- environment connection/lifecycle state;
- development process state;
- Run/Restart/Stop actions when supported;
- Publish only when a real deployment module exists.

Avoid using a green "Online" badge to mean several different things. Environment connectivity,
provider availability, development process readiness, preview reachability, and deployment status
are separate states.

## Preview seam

The current desktop preview is intentionally Electron-specific. Hosted web preview needs a second
adapter rather than browser conditionals throughout the workbench.

Common behavior:

- current preview URL;
- loading/ready/error state;
- refresh and open externally;
- project/environment association;
- run-process readiness;
- navigation policy.

Optional desktop capabilities:

- element picking;
- recording;
- picture in picture;
- browser automation;
- cookie/cache controls.

Hosted preview requirements:

- HTTPS origin routed to the correct managed workspace and port;
- sandboxed iframe with an explicit permissions policy;
- authentication that does not leak environment or provider credentials to project code;
- safe handling when user code navigates or opens a new window;
- a clear distinction between preview failure and environment disconnection.

## First UI slice

Build one slice around an existing local project and thread:

1. new three-pane shell;
2. current project/thread selection in the left rail;
3. unchanged chat/approval behavior in the middle;
4. Preview, Diff, Files/Code, and Terminal tabs on the right;
5. honest local environment and run-state labels;
6. disabled Publish affordance with no fake success path.

Do not introduce project templates, managed provisioning, deployment, or a new editor in this slice.

## UI verification

- compare web and desktop at the same viewport;
- verify long thread and project lists remain virtualized or otherwise bounded;
- verify resizing panes does not trigger continuous expensive layout work;
- verify keyboard shortcuts and command palette actions still reach the same behaviors;
- verify approvals remain reachable without opening a hidden tab;
- verify desktop titlebar drag/control areas remain usable;
- verify the workbench has a meaningful empty state when no project or preview exists.

An integrated browser or desktop pass should happen only when explicitly approved, following the
repository's testing instructions.
