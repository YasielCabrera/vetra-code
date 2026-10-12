# Prompt links

A prompt link opens Vetra Code with a prompt ready to send. Use one to share a prompt
or put a suggested fix in a pull request comment.

A link never runs anything. It opens a draft. You read the prompt, then press Send. A link cannot
change your permission mode, branch, or worktree. Your own defaults apply.

## Make a link

Open the command palette and choose **Copy prompt link**. It copies the draft in the composer.
When the project is on GitHub, **Copy prompt link with repo and model** also adds the repository
and the model you picked. Sent messages have a **Copy prompt link** button too.

Web links use the address of the Vetra Code environment you have open. The recipient
needs access to that environment. Desktop links use `vetra://` to open an installed app.
If a hosted app address is configured, copied links use that address instead. Vetra Code
does not provide a public hosted app yet.

You can also write a desktop link by hand:

```
vetra://new?prompt=Review%20this%20change
vetra://new?prompt=Fix%20the%20build&repo=owner/name&provider=codex&model=gpt-5.5
vetra://new?pr=owner/name/123&prompt=Fix%20the%20failing%20check
```

| Parameter  | Meaning                                                                       |
| ---------- | ----------------------------------------------------------------------------- |
| `prompt`   | The prompt. Required, except on pull request links. At most 8,000 characters. |
| `repo`     | A GitHub repository, as `owner/name` or its URL.                              |
| `provider` | A provider such as `codex` or `claude`.                                       |
| `model`    | A model of that provider, by its id or name.                                  |
| `pr`       | A GitHub pull request, as `owner/name/123` or its URL.                        |

Encode the prompt for a URL. In JavaScript, use `encodeURIComponent`.

## Open a link

When a hosted app is configured, its links first ask whether to open the desktop app
or continue in the connected browser. Select **Remember my choice** to skip this step next time.

- **No `repo`**: the draft opens without a project, on the machine you used last.
- **`repo`**: the draft opens in your most recently used project for that repository. A fork
  counts only for its own owner. When you do not have the repository, choose **Clone** or **Use
  without project**.
- **`provider` and `model`**: used when you have that provider set up. Otherwise your default
  model is used, and Vetra Code tells you.
- **`pr`**: opens the thread linked to that pull request on any connected machine, with the prompt
  in its composer. When no thread is linked, the draft goes on the pull request branch in a new
  worktree. Vetra Code checks the code out only after you confirm, because the checkout runs your
  setup script on it.

A thread link with a prompt, such as `vetra://threads/<environment>/<thread>?prompt=…`,
puts the prompt in that thread's composer. If you already typed a draft there, Vetra Code asks
before it replaces it.

Vetra Code removes characters you cannot see, such as zero-width and hidden tag characters, because
they can hide instructions for the agent. When a prompt had them, Vetra Code warns you that it may be
malicious.
