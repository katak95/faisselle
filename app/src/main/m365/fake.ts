import type { CallTool } from './tools'
import { TOOLS } from './tools'

/** fake mode: a Microsoft 365 with one Outlook meeting tomorrow and two emails, signed in once the code is "entered" */
export function fakeM365Server(): () => Promise<{ call: CallTool; close(): Promise<void> }> {
  let signedIn = false
  const text = (v: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] })
  return async () => ({
    async call(name) {
      if (name === TOOLS.login) { setTimeout(() => { signedIn = true }, 200); return text({ error: 'device_code_required', message: 'To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code FAKE1234 to authenticate.' }) }
      if (name === TOOLS.verify) return text(signedIn ? { success: true, userData: { displayName: 'You', userPrincipalName: 'you@example.com' } } : { success: false })
      if (name === TOOLS.logout) { signedIn = false; return text({ message: 'Logged out successfully' }) }
      if (name === TOOLS.calendarView) {
        const start = new Date(Date.now() + 86_400_000); start.setUTCHours(9, 0, 0, 0)
        return text({ value: [{ id: 'evt1', iCalUId: 'fake-ical-1', subject: 'Acme renewal', start: { dateTime: start.toISOString().slice(0, 19), timeZone: 'UTC' }, end: { dateTime: new Date(start.getTime() + 1800_000).toISOString().slice(0, 19), timeZone: 'UTC' },
          attendees: [{ emailAddress: { name: 'Maya Chen', address: 'maya@acme.example' } }], onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/fake' }, bodyPreview: 'Renewal terms and the Q3 rollout.' }] })
      }
      if (name === TOOLS.event) return text({ subject: 'Acme renewal', body: { contentType: 'text', content: 'Agenda: renewal terms, Q3 rollout.' } })
      if (name === TOOLS.listMail) return text({ value: [{ id: 'm1' }, { id: 'm2' }] })
      if (name === TOOLS.readMail) return text([
        { id: 'm1', from: 'Maya Chen', to: 'You', subject: 'Renewal pricing', received: '2026-11-18T10:00:00Z', text: 'Can we keep the 2025 price if we sign for two years?' },
        { id: 'm2', from: 'You', to: 'Maya Chen', subject: 'Re: Renewal pricing', received: '2026-11-18T12:00:00Z', text: 'Let us discuss it on Thursday.' },
      ])
      return text({ error: `unknown tool ${name}` })
    },
    close: async () => {},
  })
}
