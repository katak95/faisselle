# Amazon Bedrock and Microsoft 365

This fork can write summaries with Claude on Amazon Bedrock instead of the local model, and read your Outlook
calendar and email (read only) through Microsoft 365. Both are off until you turn them on in Settings. When the
notes model is Bedrock, transcripts, notes and the related emails are sent to Bedrock in your AWS account. Speech to
text and meaning search stay on your computer.

## Amazon Bedrock

Settings → Notes model → Where summaries are written → Amazon Bedrock (Claude).

1. **AWS sign-in start URL**: your IAM Identity Center portal, like `https://my-org.awsapps.com/start`.
2. **Identity Center region**: the region Identity Center lives in (for example `eu-west-1`).
3. **Sign in to AWS**: the browser opens AWS's approval page with a code. Approve it there.
4. Pick the **Account** and the **Role**.
5. **Bedrock region** and **Model**: `eu-west-1` and `eu.anthropic.claude-haiku-4-5-20251001-v1:0` (Claude Haiku 4.5 through the EU inference profile) by default. The model ID chooses
   how Faisselle reaches Bedrock, and so the permission the role needs:

   | Model ID | Endpoint | The role needs |
   |---|---|---|
   | `anthropic.claude-haiku-5-5`, `anthropic.claude-haiku-4-5`… (Claude in Amazon Bedrock) | Messages API, `bedrock-mantle.<region>.api.aws` | `bedrock-mantle:CreateInference` |
   | `eu.anthropic.claude-haiku-4-5-20251001-v1:0`, `anthropic.claude-…-v1:0`, an inference profile (`eu.`, `us.`, `global.`…) or an ARN | InvokeModel, `bedrock-runtime.<region>.amazonaws.com` | `bedrock:InvokeModelWithResponseStream` |

   A role that already works for other projects with InvokeModel works here with the same model ID or inference
   profile. With Claude Haiku 4.5 and older models, Faisselle leaves out the effort level, which they don't take.
6. **Check**: sends one very short request. When AWS refuses it, the message names the permission the role lacks.

What to check in AWS:

- Claude Haiku 5.5 is enabled for your account in the Bedrock console, in the region you chose.
- The Identity Center permission set behind the role allows Bedrock inference.

**The local notes model.** On the first run, the welcome screen asks first: tick *Write summaries with Amazon
Bedrock* and no notes model is downloaded (the notes model waits for that screen; speech to text and meaning search
download as usual). Switching to Bedrock later stops a notes model download still running (what came in is kept, so
switching back picks up where it stopped), and Settings offers to **Remove** a notes model already on the computer.
Switching back to this computer downloads it again.

Faisselle keeps the Identity Center token sealed with your system keychain, in `aws-sso.json` in its data folder. The
role's keys stay in memory and are fetched again before they expire. A meeting's summary stays under 100K input
tokens, so long meetings are summarised in parts at the lower price.

## Microsoft 365 (read only)

Settings → Microsoft 365 → Connect. Faisselle starts the open-source
[Softeria ms-365-mcp-server](https://github.com/Softeria/ms-365-mcp-server) itself, in read-only mode with only these
tools: `login`, `verify-login`, `logout`, `get-calendar-view`, `get-calendar-event`, `list-mail-messages`,
`read-mail-text`. Nothing can be sent, changed or deleted.

- Microsoft's page opens; enter the code Settings shows.
- **Show the Outlook calendar** adds your Outlook meetings to the agenda.
- For a meeting, Faisselle reads the invite (Outlook meetings) and up to 8 recent emails with the people invited. They
  go into the summary, the follow-up email and the brief as context. Each note can turn this off
  (**Read the invite and related emails**).
- If your organisation blocks the default app, ask your administrator to register one (delegated `Calendars.Read`,
  `Mail.Read`, `User.Read`, public client) and fill in **Use your organization's own app**.

### An app that doesn't allow the device code

The code above needs **Allow public client flows** turned on in the app's Azure settings. When it's off (Microsoft
then refuses with `AADSTS7000218`), Faisselle signs in with the browser instead, on a redirect URI the app already has,
for example the one Claude Code uses with it. Nothing changes in Azure.

1. Settings → Microsoft 365 → **Use your organization's own app**: the **Application (client) ID** and **Directory
   (tenant) ID**.
2. **Sign in with** → **The browser (apps without public client flows)**.
3. **Redirect URI**: one of the app's, exactly as in Azure (Authentication). For the app Claude Code uses, it is
   `http://localhost:PORT/callback`, `PORT` being its callback port: `claude mcp get <server>`, or `oauth.callbackPort`
   for that server in `~/.claude.json`. Only `http://localhost:PORT/…` or `http://127.0.0.1:PORT/…` addresses work.
4. **Client secret**: only if that redirect URI is on the app's **Web** platform (Microsoft then asks for it; on
   **Mobile and desktop applications** it refuses one). It is sealed with the system keychain and never shown again.
5. **Save**, then **Connect**: Microsoft's page opens in the browser and comes back to Faisselle.

Faisselle asks for what the app is already allowed (`https://graph.microsoft.com/.default`): the delegated permissions
listed above and, for documents, those listed below, approved by an administrator. It keeps the sign-in sealed in
`m365-oauth.json` in its data folder and renews it by itself; **Disconnect** forgets it. While Faisselle signs in, the
redirect URI's port must be free: finish a Claude Code sign-in that uses it first. Settings says what Microsoft
refused (the secret, the redirect URI, the port).

The server's token cache lives in Faisselle's data folder (`m365-token-cache.json`).

### SharePoint and OneDrive (optional)

Settings → Microsoft 365 → **Search SharePoint and OneDrive**. Off by default.

- When it is on, the server starts in work-account mode (`--org-mode`) and also turns on `search-query` (Microsoft
  Search) and `download-bytes`. Still read only, and nothing else is turned on. You sign in again so Microsoft asks for
  the new permissions.
- Microsoft Search's tool asks for these delegated permissions: `Files.Read.All`, `Sites.Read.All`, `People.Read`,
  `Chat.Read`, `ChannelMessage.Read.All` (plus `Mail.Read` and `Calendars.Read`). Faisselle only searches documents
  (`driveItem`, `listItem`); it never reads chats or channels, but the tool can't be turned on without asking for them.
  Most tenants need an **administrator to approve** them once: Settings says so when Microsoft refuses.
- For each meeting, Faisselle searches with the meeting title's meaningful words and the companies of the people invited
  (from their email addresses), in documents changed in the last 12 months. It takes up to 8 hits with Microsoft's
  snippets, and reads in full the 3 most relevant ones under 8 MB (Word, PowerPoint, Excel, PDF, text), each cut to
  3,000 characters.
- The documents are used by the **brief** (with a "Related documents" list of links, built by Faisselle from the
  search, never by the model), the **summary** (as background only) and **Ask** about a meeting. The follow-up email
  doesn't use them.
- Each note's **Read the invite, related emails and documents** turns all of this off for that meeting.

## Summaries, action items, follow-up email, brief

- **Summary templates** (Settings): General, One-on-one, Client call, Retrospective, Job interview, Project status,
  Board or committee, plus your own. Each note can pick another one under its summary; picking writes the summary again.
- **Action items**: taken from the summary once it is written (as JSON; Bedrock is held to a schema). Tick, add,
  remove, copy. Ticks survive a rewrite.
- **Follow-up email**: written on request from the summary and action items; copy it or open it in your email app.
- **Brief**: on a note prepared for an upcoming meeting. It uses earlier meetings with the same people, their open
  action items, the invite and related emails.

## Confluence (Atlassian)

Settings → Atlassian → **Connect**. Faisselle talks to Atlassian's own remote MCP server
(`https://mcp.atlassian.com/v2/mcp`) and signs in with OAuth: your browser opens Atlassian's sign-in page, then comes
back to Faisselle on `http://localhost:33418/oauth/callback` (another free port if that one is taken). The sign-in is
sealed with your system keychain in `atlassian.json` in Faisselle's data folder.

- **Send to Confluence** (a note's Copy menu, once its summary is written) creates a page in your **personal space**,
  under a page called **Meeting notes** that Faisselle makes the first time. The page has the meeting's date, length and
  people, the summary, and the action items as Confluence tasks (ticked ones ticked).
- Sending the same note again **updates** its page (a new version), it never makes a copy. A page deleted in
  Confluence is made again.
- Faisselle reads the tools Atlassian's server offers when you connect and adapts to their names and parameters, so a
  change on Atlassian's side (v1 to v2) doesn't break sending.

What may be needed on Atlassian's side:

- An organisation admin may have to allow Atlassian's MCP server (Rovo) for your site, and the Confluence write
  permission for it. Settings says so when Atlassian refuses.
- Some organisations restrict OAuth redirects: the `localhost` callback above must then be allowed.
- You need a personal space in Confluence (Profile → Personal space). Faisselle says so if there is none.
