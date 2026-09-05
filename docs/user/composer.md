# Messages and context

Messages can contain up to 120,000 characters. If a draft is longer, Vetra Code keeps it in the
composer and shows how many characters need to be removed. Shorten the draft or split it into
multiple messages, then send again in the same thread.

Messages can contain up to 120,000 characters. Longer drafts stay in the composer
so you can shorten them or split them into several messages.

## Attach files

Attachments upload as soon as you add them while connected to a server that supports uploads.
The send button becomes available after every upload finishes. Failed uploads can be retried or
removed. On mobile, tap **+** to open
the photo library from either the compact or expanded composer. When the connected server supports
file uploads, **+** opens a menu beside the button with **Photo Library** and **Choose Files**.
Videos use the server's file upload limit. You can also share photos, videos, and files into
Vetra Code from other apps through the system share sheet. Mobile uploads happen when the message
sends, so queued messages keep their files until they deliver. Select a received file on mobile
to save it or open it in another app through the system share sheet.

Uploads begin when you add an attachment. All uploads must finish before the
message can send. Retry or remove a failed upload. On web and desktop, reloading
before an upload finishes requires you to attach that file again.

You can drag or paste images into the web or desktop composer. HEIC and HEIF
photos are converted to JPEG there and when selected from the iOS photo library;
the image limit applies after conversion. On mobile, you can also send files to
Vetra Code through another app's system share sheet.

See [images and videos](#images-and-videos-in-messages) for previewing and saving media.

## Queue messages offline on mobile

Mobile keeps local copies of draft attachments, so you can preview them and queue
messages while disconnected. Uploads resume when you reconnect. Drafts and queued
messages survive app restarts. Signing out of Vetra Connect keeps that work on your
device until you sign back into the same account.

## Custom models

On web and desktop, use Settings → Providers → **Models** to add an unlisted model with a custom
name and options. Only options supported by the provider integration affect turns. Antigravity
uses its account catalog and does not support custom models.

## Model defaults

Vetra Code remembers the last provider, model, and model options you selected and reuses that
selection for new threads. A model configured in a project's settings overrides the remembered
selection for that project; resetting the project setting returns it to the remembered selection.

Model options shown as provider defaults remain display values until you choose them in Vetra Code.
Vetra Code only sends options you selected explicitly, so an unset reasoning level or service tier can
still come from the provider's own configuration.

## Quote an assistant response

On web and desktop, select text within one assistant response and choose
**Cite in composer**. You can add a comment about the quote and write instructions
around it.

Select the quote in a draft or sent message to return to its source. If the source
is unavailable or has changed, the saved quote remains readable.

Select a chip in the composer or a sent message to open the source thread, scroll to the response,
and highlight the quoted passage — including in older history. The
highlight pulses, holds for a moment, then fades on its own; press `Escape` to stop the navigation
or clear it early. If the source is unavailable or its text has changed, the saved quote stays
readable and Vetra Code shows a warning.

## Recall a sent prompt

Press `ArrowUp` in an empty composer to bring back the last prompt you sent in this thread. Press
`ArrowUp` again to go further back, and `ArrowDown` to come forward. Moving forward past the newest
prompt clears the composer. Recall walks the prompts loaded in the thread. Attachments, terminal
context, and other extras from the original message are not restored, only the text you typed. A
composer that holds an attachment or a picked element does not count as empty.

On web, desktop, and mobile, select a link to an image or video to open it inside Vetra Code.
Workspace image and video links open the file viewer. Links to media outside the workspace
open a media preview.
Videos opened from the file explorer or a file-viewer tab also play inside Vetra Code. They
stream from the environment as needed, rather than downloading the entire video before playback.
Paths in inline code, such as `/tmp/recording.mp4`, work the same way. Image embeds stay inline;
video embeds show a player with the browser's controls, full screen included. Visible video previews load
an initial frame when supported, but stay paused until you press Play. Video file references use
a filmstrip icon.

On web and desktop, hover over a preview to see its full file path or original URL. Right-click
to copy that reference, save the image or video, or copy an image to the clipboard. The video
player's built-in controls can download a video too. If the player cannot decode a video, its error message
offers a link to open the source in the browser. Workspace media also offers **Copy relative
path** and **Open in file viewer**. These actions are available in expanded previews too.

On mobile, touch and hold an inline image or a video thumbnail to see its source,
copy the path or URL, or choose **Save or share**. Workspace files can open in the file viewer
from the same menu. Saving downloads a copy only when you request it; it does not change how
the video buffers during playback. On iOS, touch and hold a file reference in a message to
copy its full or relative path or open it in the file viewer.

Use Markdown image syntax to embed either kind of media:

```markdown
![Screenshot](/tmp/screenshot.png)
![Recording](/tmp/recording.mp4)
[Open recording](/tmp/recording.mp4)
```

Relative paths resolve from the thread's workspace. Absolute paths and `file://` links refer to
the environment's machine, even when you connect remotely or use your phone. Supported media
can live outside the workspace, including in Downloads or `/tmp`.

Vetra Code serves the original file without adding it to attachment storage. If that file is moved
or deleted, its preview can no longer load from the environment. A browser or device may still
have a cached copy. Supported video formats and codecs depend on the browser or device.

Bare paths in ordinary prose and paths inside code blocks stay text. Raw HTML `<video>` tags
are not supported; use the Markdown embed syntax above.

## Files outside the workspace

When an agent links to a file it wrote outside the workspace, such as a Markdown report in
`/tmp`, select the link to open it in the file viewer. The viewer shows the file read-only, with
rendered Markdown available as usual; it cannot edit files outside the workspace. The workspace
file tree stays hidden because it does not describe the open file. HTML and PDF files outside the
workspace open the same way as ones inside it. Because such a file is served on its own, an HTML
page outside the workspace cannot load scripts, styles, or images from files beside it.

## HTML and PDF files in the file viewer

On web and desktop, the file viewer shows HTML and PDF files as a rendered page. Use the
source toggle in the viewer's header to switch an HTML file between the page and its markup; the
choice persists like the rendered-Markdown toggle. A link to a line always opens the source. HTML
runs in an isolated frame with no access to your Vetra Code session. On desktop, the integrated
browser remains available from the same header for a full browser view.

## Changing projects

On web and desktop, changing the project from a new thread keeps the current environment when that
project exists there. If it does not, Vetra Code selects another environment that has the project.

## Notices above the composer

On web and desktop, loading and syncing statuses fill the available banner width beside the
stash tab. Task progress appears above the composer, while the timeline's working timer shows
only elapsed time.

On web and desktop, additional notices peek out above the attached banner. Hover over the peek
to reveal them, or focus **Show other notices** with `Tab` and press `Enter` or `Space`. Press
`Escape` to close the stack and return focus to that control. On a touchscreen, tap the peek to
open the stack. Interacting with the attached banner or composer does not open the stack.

## Prompt stash

On web and desktop, press `Cmd+S` on macOS or `Ctrl+S` on Windows and Linux to save
the current prompt and its attachments for later. Wait for uploads to finish first.
With an empty composer, the same shortcut restores a single stash or opens the
stash menu when there are several.

Stashes containing uploaded files must be restored in their original environment.
Those files are retained for 24 hours. After an upload expires, restore the prompt
and use **Attach again** or remove the missing file before sending.

## Commands and skills

Type `/` for commands or `$` to add a skill from the selected environment and
provider. On mobile, both are also available before starting a thread on
**New task**.

The slash menu also includes skills unless you turn off **Settings → General →
Show skills in slash menu**. Only skills enabled for the provider are listed.

Provider commands must start the message to run. Vetra Code commands such as
`/model` and `/plan`, and skill mentions, work on any line.

By default, the `/` menu includes skills. To keep this menu command-only, turn off **Show skills in
slash menu** in **Settings → General**. Skill results use the `/skill:Skill Name` label and add the
same `$name` skill token to your message. The original skill name remains searchable. If the provider
also reports that skill as a native slash command, Vetra Code hides the duplicate native entry and keeps
the `/skill:Skill Name` label.

A skill token runs the skill wherever it sits in your message. Vetra Code sends it to each provider in
the form that provider runs, so the text before and after the token is kept. Skills that only you may
start, and never the agent on its own, work the same way. A skill you switched off in the provider's
settings does not appear in either menu.

Provider commands such as `/compact` only run when they open the message, so the `/` menu offers
them only there. Vetra Code's own commands, such as `/model` and `/plan`, and skills stay available on
any line.

On desktop, press `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux from a new thread to
start it in the background. Vetra Code opens another new thread and shows an **Open** action for the
thread that started. The new thread keeps the selected workspace mode and base branch. If **New
worktree** is selected, each background thread creates its own worktree.
