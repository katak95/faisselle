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
4. Pick the **Account** and the **Role**. The role must be allowed to call Claude through Bedrock's Messages API
   endpoint (`bedrock-mantle.<region>.api.aws`, signed for the `bedrock-mantle` service).
5. **Bedrock region** and **Model**: `eu-west-1` and `anthropic.claude-haiku-5-5` by default. If your region serves
   Claude through a cross-region inference profile, put its ID here.
6. **Check**: sends one very short request.

What to check in AWS:

- Claude Haiku 5.5 is enabled for your account in the Bedrock console, in the region you chose.
- The Identity Center permission set behind the role allows Bedrock inference.

Yogurt keeps the Identity Center token sealed with your system keychain, in `aws-sso.json` in its data folder. The
role's keys stay in memory and are fetched again before they expire. A meeting's summary stays under 100K input
tokens, so long meetings are summarised in parts at the lower price.

## Microsoft 365 (read only)

Settings → Microsoft 365 → Connect. Yogurt starts the open-source
[Softeria ms-365-mcp-server](https://github.com/Softeria/ms-365-mcp-server) itself, in read-only mode with only these
tools: `login`, `verify-login`, `logout`, `get-calendar-view`, `get-calendar-event`, `list-mail-messages`,
`read-mail-text`. Nothing can be sent, changed or deleted.

- Microsoft's page opens; enter the code Settings shows.
- **Show the Outlook calendar** adds your Outlook meetings to the agenda.
- For a meeting, Yogurt reads the invite (Outlook meetings) and up to 8 recent emails with the people invited. They
  go into the summary, the follow-up email and the brief as context. Each note can turn this off
  (**Read the invite and related emails**).
- If your organisation blocks the default app, ask your administrator to register one (delegated `Calendars.Read`,
  `Mail.Read`, `User.Read`, public client) and fill in **Use your organization's own app**.

The server's token cache lives in Yogurt's data folder (`m365-token-cache.json`).

## Summaries, action items, follow-up email, brief

- **Summary templates** (Settings): General, One-on-one, Client call, Retrospective, Job interview, Project status,
  Board or committee, plus your own. Each note can pick another one under its summary; picking writes the summary again.
- **Action items**: taken from the summary once it is written (as JSON; Bedrock is held to a schema). Tick, add,
  remove, copy. Ticks survive a rewrite.
- **Follow-up email**: written on request from the summary and action items; copy it or open it in your email app.
- **Brief**: on a note prepared for an upcoming meeting. It uses earlier meetings with the same people, their open
  action items, the invite and related emails.
