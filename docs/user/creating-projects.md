# Create a project from a prompt

The root page (`/`) shows the regular chat composer without selecting a project. It keeps one local
landing draft, so refreshing the page restores the same prompt instead of creating another draft
thread. Opening or refreshing this page does not create a directory, project, or server thread.

Use the project selector in the composer before starting a thread. You can choose any existing
project or choose **New project**. You can type the prompt first, but Vetra Studio keeps sending
disabled until the selector points to a project.

Choosing **New project** opens a separate location step. Select the environment and parent
directory there. Vetra Studio proposes a folder name from the first prompt and adds a short project
identifier so separate projects do not collide. You can edit the folder name before continuing.
Confirming this step creates the project and its directory, but does not start a thread or contact an
agent.

After the selector shows the chosen project, the first send creates the first thread inside that
project and starts the agent turn. If project creation fails, the prompt and attachments remain in
the composer so you can change the location or try again.

Locations always belong to the selected environment. A path for a remote environment is resolved on
that remote machine, not on the device running the browser.
