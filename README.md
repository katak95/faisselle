<p align="center">
  <img src="app/build/wordmark.svg" width="300" alt="Faisselle">
</p>

<p align="center">
  Private AI meeting notes, with summaries on your computer or on Amazon Bedrock, Microsoft 365 context and Confluence reports.
</p>

## Introduction

<p align="center">
  Faisselle records your calls without adding a bot to the meeting.
</p>
<p></p>
<p align="center">
  <sub>macOS 14.4+ (Apple Silicon) · Windows 10 2004+ (x64) · Ubuntu 22.04+ or similar (x64 AppImage) · 8 GB memory (less with Amazon Bedrock)</sub><br><br>
  <a href="docs/README.md">Help</a> · <a href="docs/bedrock-and-m365.md">Bedrock, Microsoft 365 and Confluence</a> · <a href="docs/building.md">Build and run locally</a> · <a href="LICENSE">MIT license</a><br><br>
  Faisselle is a fork of <a href="https://github.com/FrigadeHQ/yogurt">Yogurt</a>, made by <a href="https://frigade.com">Frigade</a>, under the MIT license.
</p>

## Download

Installers for Mac, Windows and Linux are on the [releases page](https://github.com/katak95/faisselle/releases). Faisselle
updates itself from there (on Mac, once the app is signed).

## What Faisselle adds to Yogurt

- **Amazon Bedrock.** Summaries written by Claude on Bedrock (Haiku 5.5 by default) instead of a model on your computer, signed in with AWS IAM Identity Center. No notes model to download.
- **Summary templates.** One-on-one, client call, retrospective, interview, project status, committee, and your own.
- **Action items.** A list to tick, taken from each summary.
- **Follow-up email and brief.** A draft email after the meeting, and a brief before it from earlier meetings with the same people.
- **Microsoft 365, read only.** The Outlook calendar, related emails and SharePoint / OneDrive documents as context.
- **Confluence.** A meeting report sent to your personal space, updated when you send it again.

All of these are off until you turn them on in Settings. [How to set them up, and what each one sends where](docs/bedrock-and-m365.md).

## What it does

- **Live transcripts.** Faisselle records calls and turns speech into text as you talk.
- **Meeting summaries.** Faisselle writes up the conversation and any notes you add.
- **Private by default.** Your audio, transcripts and AI processing stay on your computer, unless you turn on Bedrock, Microsoft 365 or Confluence in Faisselle.
- **Free and open source.** You can use Faisselle without an account.
- **Who said what.** Faisselle names speakers from Zoom, Teams and Meet on Mac, Windows and Linux.
- **Languages.** Multi-language mode transcribes 99 languages, follows each side of the call in its own language, and keeps up when someone switches languages mid-meeting.
- **Recording reminders.** Faisselle offers to record when a supported call starts.
- **Answers with sources.** Faisselle answers questions across meetings and links to the source.
- **Folders and search.** You can find meetings by folder, title, notes or transcript.
- **Copy and export.** You can copy notes or transcripts, or save both as Markdown.
- **Local MCP server.** When you turn this on, apps on your computer can read your notes, transcripts, saved audio and each meeting's calendar details (attendees' names and emails).
- **Automatic stop.** By default, Faisselle stops recording when it detects that your call has ended. A recording you start yourself with New note asks first instead, since it may not be a call.

## Watch the demo

https://github.com/user-attachments/assets/da16b894-beb1-491a-89e1-fd10666dc9b8

## How it works

1. **Record.** Start recording your microphone and call audio; you can add your own notes.
2. **Transcribe.** Faisselle uses whisper.cpp and, on supported Macs, Apple SpeechAnalyzer.
3. **Summarize and ask.** A local open-weight model runs through llama.cpp, or Claude on Amazon Bedrock in your AWS account if you choose it in Faisselle.

With the local model, meeting data stays on your computer, and Faisselle goes online only for model downloads and update checks. With Bedrock, transcripts and notes go to Bedrock in your AWS account; with Microsoft 365, Faisselle reads your calendar, emails and documents; with Confluence, it writes the report you send.

<details><summary>Where your meetings, recordings, settings and models are stored</summary>

- Mac uses `~/Library/Application Support/Faisselle`.
- Windows uses `%APPDATA%\Faisselle`.
- Linux uses `~/.config/Faisselle`, or `$XDG_CONFIG_HOME/Faisselle` if set.

</details>

## FAQ

<details><summary><strong>What kind of computer do I need?</strong></summary>

<br>

> A Mac with Apple silicon and macOS 14.4 or newer, a 64-bit PC with Windows 10 (version 2004) or newer, or a 64-bit Linux computer with Ubuntu 22.04 or newer. Each needs at least 8 GB of memory. If your computer is too slow, Faisselle tells you during setup. On Windows and Linux, you connect your calendar with a private calendar link.

</details>

<details><summary><strong>Does Faisselle join my meetings?</strong></summary>

<br>

> No. Faisselle records your microphone and the sound playing on your computer. No bot joins the call, so let the other people on the call know you’re recording.

</details>

<details><summary><strong>Are recordings saved?</strong></summary>

<br>

> Audio is saved by default, and you can turn this off for future meetings in Settings.

</details>

<details><summary><strong>Is Faisselle free?</strong></summary>

<br>

> Yes. Faisselle is free and open source under the MIT license. No account is needed. With Amazon Bedrock, AWS bills your account for what the model reads and writes (Haiku is among its cheapest models).

</details>

<details><summary><strong>Does Faisselle work offline?</strong></summary>

<br>

> Yes, with the local notes model: after a one-time download of the AI models, transcription and summaries run locally on your computer. With Amazon Bedrock, recording and transcription still work offline, but summaries need a connection.

</details>

<details><summary><strong>Does Faisselle train AI on my meetings? Can anyone at Faisselle read them?</strong></summary>

<br>

> No. Your recordings, transcripts and notes stay on your computer, and Faisselle has no server that receives them, so nobody at Faisselle can read them. The AI models run on your computer and don't learn from your meetings. Faisselle only goes online to download its models, check for updates and, if you add one, read your calendar link, plus Bedrock, Microsoft 365 or Confluence when you turn them on. Amazon Bedrock doesn't use what it receives to train models, and nothing goes to Faisselle's authors.

</details>

<details><summary><strong>Is Faisselle safe for confidential meetings?</strong></summary>

<br>

> Faisselle keeps everything on your computer: audio, transcripts and notes are never uploaded, and transcription and summaries run offline. That makes it a good fit for client calls, therapy sessions, legal work and board meetings where audio can't go to a cloud service. With Amazon Bedrock on, transcripts and notes leave your computer for your AWS account (audio never does): keep the local model for meetings that must stay on your computer. You can also turn off saving audio in **Settings**, and Faisselle is open source, so anyone can check what it does. Follow your own rules on getting consent to record.

</details>

<details><summary><strong>How much memory do I need?</strong></summary>

<br>

> At least 8 GB. Faisselle checks your computer during setup and picks the best transcription and notes models it can run well. With 16 GB or more, Faisselle can usually run a larger notes model that writes better notes.

</details>

<details><summary><strong>Can I turn an existing recording into notes?</strong></summary>

<br>

> Yes. Use **Upload a file** to add an MP3, M4A or WAV recording. Faisselle transcribes it on your computer and writes notes, the same as for a live meeting.

</details>

<details><summary><strong>Can I ask questions across all my meetings?</strong></summary>

<br>

> Yes. Use **Ask** to ask about one meeting, a folder, or all your meetings at once, for example "what did we decide about pricing?". Answers point to the meetings they came from, and everything runs on your computer.

</details>

<details><summary><strong>How accurate is it compared to cloud transcription?</strong></summary>

<br>

> Faisselle uses Whisper large-v3-turbo on computers that can run it, the same family of models many cloud services use, so English accuracy is close to cloud transcription. Smaller computers get a smaller Whisper model, which is faster but makes more mistakes, especially outside English. You can add names and words to a custom vocabulary so they're spelled right.

</details>

<details><summary><strong>How much does setup download?</strong></summary>

<br>

> It depends on your computer. Faisselle sets up transcription first, then downloads the notes models selected for your computer. Recording works once setup finishes, and notes and questions work offline once the notes model is in.

</details>

<details><summary><strong>How do I connect my assistant app?</strong></summary>

<br>

> In **Settings → AI apps**, turn on access, copy the helper command, and add it as a local MCP server in your assistant app. Access is off by default. The app can read your meetings (including their calendar details: the event, and attendees' names and emails), notes and transcripts, but cannot change them. It may send what it reads to its own online model. Turn access off in Faisselle to stop further reads.

</details>

<details><summary><strong>Can other apps read my notes through MCP?</strong></summary>

<br>

> Access is off until you enable it in **Settings → AI apps**. Apps get read-only access to meetings (with their calendar event and attendees' names and emails), notes and transcripts. Mac and Linux use a socket in your profile folder with `0600` permissions, so only your user account can open it. Windows uses a named pipe with a new random name each launch, stored only in your profile folder. There is no per-app token, so any app running under your account can read while access is on. Settings shows connected apps by their self-reported names.

</details>

<details><summary><strong>Which AI models does Faisselle use?</strong></summary>

<br>

> Transcription uses Whisper through whisper.cpp, with large-v3-turbo or a smaller model depending on your computer. On supported Macs, Apple SpeechAnalyzer supplies live words while Whisper produces the saved transcript. Summaries and answers use a local open-weight model from the Gemma 4, gpt-oss or Qwen3 families, chosen for your hardware and run through llama.cpp, or Claude on Amazon Bedrock (Haiku 5.5 by default) if you choose it. The app uses Electron and needs no account.

</details>

<details><summary><strong>Which languages does Faisselle support?</strong></summary>

<br>

> Pick **Multi-language** in **Settings → Language → Spoken language** to transcribe 99 languages. You can also switch from the **English** menu in a note’s footer before or during recording. English only is the default, and it’s the fastest and most accurate choice for English meetings.
>
> In Multi-language mode, you and the other side of the call can each speak your own language, and Faisselle follows along when someone switches languages mid-meeting. Summaries follow the meeting’s main language, or the one you pick in **Settings → Summary language**. Answers in Ask follow your question’s language. Settings also offers 32 app languages.

</details>

<details><summary><strong>Which call apps does Faisselle work with?</strong></summary>

<br>

> You can record calls in any app because Faisselle captures your microphone and system audio. Call detection covers Zoom, Teams and Meet. On Mac, Faisselle can also read their speaker names with Accessibility permission, when the call app shows who is speaking.

</details>

<details><summary><strong>How does Faisselle know a call has started?</strong></summary>

<br>

> It checks which apps are using your microphone. For browser calls, it also checks the tab title or a nearby calendar event with a call link. This triggers an offer to record; recording starts only when you choose to.

</details>

<details><summary><strong>How do I connect my calendar?</strong></summary>

<br>

> On Mac, allow Calendar access in Settings. Faisselle reads the calendars already on your computer and lets you choose which ones to show. On any computer, you can also sign in to Microsoft 365 in Faisselle to read your Outlook calendar (read only).

</details>

## Support

- [Help](docs/README.md)
- [Discord](https://yogurt.so/discord) of Yogurt, the app Faisselle is built on
- [Report a bug](https://github.com/katak95/faisselle/issues)

## Development

- [Build and run locally](docs/building.md)
- [How Faisselle follows Yogurt](docs/syncing-with-yogurt.md): Yogurt's changes are merged and released every day.

[MIT](LICENSE) · Copyright 2026 Frigade (Yogurt). Faisselle's changes are under the same license.
