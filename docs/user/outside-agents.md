# Outside agents

Agents that Vetra Code did not start can work with an environment through its MCP
server. They can read projects and threads, start and message threads, work
with tickets, and check which providers and models are available. This covers
Claude Code or Codex in your own terminal, ChatGPT, and bots that support MCP.
Each agent signs in once, and you choose what it may do.

## Get the MCP URL

In **Settings → Connections**, the **MCP server** row shows the URL of the
environment you are connected to. **Connect an agent** next to it gives
ready-to-paste setup for common agents. For a saved environment, open its menu and
choose **Copy MCP URL**. The URL is the environment's address followed by
`/mcp`, for example:

```text
https://<environment-address>/mcp
```

The **MCP server** row prefers the address your pairing links use, such as a
Tailscale HTTPS address when you have turned it on. A saved environment's URL
uses the route this device is connected over, so an agent on the same device
can reach it.

- **An agent on your own computers** can use `localhost` on the host, Vetra
  Connect, or any `https` address. See [remote access](./remote-access.md). Signing in sends the
  agent's credentials to the environment, and agents only do that over `https`
  or to `localhost`. A plain-`http` LAN or Tailscale address, like
  `http://100.x.y.z:4873`, lets an agent find the environment but not finish
  signing in.
- **A hosted agent**, such as ChatGPT or a bot running in the cloud, must reach
  the environment from the internet. Use the Vetra Connect address. A Tailscale
  address only works from your own tailnet.

## Approve a sign-in

The first time an agent connects, it opens a sign-in page on the environment.
The page names the agent and where its access goes:

- For an agent on your computer, approval returns to a `localhost` address on
  the computer that opened the page.
- For a hosted agent, approval goes to that service, such as `chatgpt.com`.
  Anyone who runs that service gets the access.

Only approve a sign-in you just started. To approve, enter a pairing code. Create
one in **Settings → Connections → MCP server → Connect an agent**, or run
`vetra auth pairing create` on the host. A browser already signed in to the
environment with permission to manage access can approve without a code.

Then choose what the agent may do:

- **Read only** is the default. The agent can read projects and threads and see
  the available providers and models. It cannot change anything.
- **Supervised** through **Full access** also let it start, message and stop
  threads in every project. A thread it starts or steers cannot run with more
  permissions than the mode you chose.

Under **Tools**, **All tools** is the default. **Tickets only** limits the agent
to tickets and their plans, plus listing projects so it can file new tickets. It
cannot see or start threads. With **Read only**, it can only read tickets.

## Tickets

An outside agent can list, read, create and edit tickets and their plans, add
notes, link tickets, and comment on plans. Its changes show its name in the
ticket's activity.

- A new ticket needs a project. Tell the agent which project to file it in.
- To attach a file, the agent uploads it to the environment. It cannot attach a
  file by its path on the host.
- Only you can move a GitHub ticket into or out of a closed status, because that
  closes or reopens the issue on GitHub.

## Claude Code

```sh
claude mcp add --transport http vetra-code https://<environment-address>/mcp
claude mcp login vetra-code
```

`claude mcp login` opens the sign-in page in your browser. On a machine
without a browser, add `--no-browser`, open the printed URL elsewhere, and
paste the final URL back when asked. `claude mcp list` shows `vetra-code` as connected
once you approve.

## Codex

```sh
codex mcp add vetra-code --url https://<environment-address>/mcp
codex mcp login vetra-code
```

`codex mcp login --no-browser` prints the sign-in URL instead of opening it.
`codex mcp list` shows `vetra-code` with OAuth once you approve.

## ChatGPT

Add the environment as a custom MCP app in ChatGPT's apps settings:

1. Create a new app or plugin with a custom MCP server.
2. Set the server URL to `https://<environment-address>/mcp`, using the T3
   Connect address.
3. Choose **OAuth** for authentication. ChatGPT discovers the rest; you do not
   need a client ID or secret.
4. Create the app, then approve the sign-in page that opens.

## Other agents and bots

Any agent that supports remote MCP servers over HTTP with OAuth can connect. Give
it the MCP URL and choose OAuth, and the agent finds the sign-in settings itself.
Agents without OAuth support can use an access token instead.

## Agents without browser sign-in

Scripts, bots and MCP clients that only accept a fixed `Authorization` header
use an access token instead of signing in. In **Settings → Connections → MCP
server → Connect an agent**, choose **Access token**, give it a name, and pick
its tools and what it may do, as you would on the sign-in page. The token is
shown once, so copy it right away. The agent sends it with every request:

```text
Authorization: Bearer <token>
```

For Claude Code:

```sh
claude mcp add --transport http vetra-code https://<environment-address>/mcp --header "Authorization: Bearer <token>"
```

On the host, `vetra auth mcp-token --label "Release bot"` prints a read-only
token. Add `--access` and `--tools tickets` to choose its access and tools.

Anyone with the token gets its access, so keep it secret. Unlike a sign-in, a
token also works over a plain-`http` LAN or Tailscale address.

## Scripts on the host

On the machine that runs the environment, `vetra thread` uses the same tools
without a sign-in:

```sh
id=$(t3 thread start . "Find why the tests are slow")
t3 thread send "$id" "Now fix it" --wait
t3 thread show "$id"
t3 thread list
```

`.` means the project that contains the current folder; a project id also
works. A new thread uses the project's default model and permission mode, and
runs in the project folder unless you pass `--worktree <base-branch>`. `send`
never interrupts: a busy thread gets the message as its next turn. Pass `-` as
the message to read it from stdin.

`--wait` prints the agent's reply. It exits 1 when the run fails or stops, and
2 when the agent waits for an answer you give in the app. Add `--json` for a
result that always includes the thread id.

## Remove an agent

Approved agents and access tokens appear under **Settings → Connections** like
other clients, marked **Tickets only** when you limited their tools. Revoke one
there to cut off its access immediately. A sign-in or access token lasts 30
days. After that, a signed-in agent asks you to approve it again, and a token
needs replacing.
