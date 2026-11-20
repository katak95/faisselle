import yazl from 'yazl'
import type { CallTool } from './tools'
import { TOOLS } from './tools'

/** a real (tiny) Word file, so fake mode reads a document the way a real one is read */
export function fakeDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new yazl.ZipFile()
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`).join('')
  zip.addBuffer(Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`), 'word/document.xml')
  zip.end()
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject)
  })
}

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
      if (name === TOOLS.search) return text({ value: [{ hitsContainers: [{ hits: [
        { hitId: 'doc1', summary: 'Proposed <c0>Acme</c0> renewal: two years at the 2025 price<ddd/>', resource: { id: 'doc1', name: 'Acme renewal proposal.docx', webUrl: 'https://contoso.sharepoint.com/sites/sales/Shared%20Documents/Acme%20renewal%20proposal.docx', lastModifiedDateTime: '2026-11-12T10:00:00Z', lastModifiedBy: { user: { displayName: 'Maya Chen' } }, size: 2048, parentReference: { driveId: 'drive1' } } },
        { hitId: 'doc2', summary: 'Q3 rollout plan for <c0>Acme</c0>', resource: { id: 'doc2', name: 'Q3 rollout.pptx', webUrl: 'https://contoso-my.sharepoint.com/personal/you/Documents/Q3%20rollout.pptx', lastModifiedDateTime: '2026-10-02T10:00:00Z', size: 0, parentReference: { driveId: 'drive2' } } },
      ] }] }] })
      if (name === TOOLS.download) return text({ contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', encoding: 'base64',
        contentBytes: (await fakeDocx(['Acme renewal proposal', 'Two-year term with a 4% discount, signed before 15 December.'])).toString('base64') })
      return text({ error: `unknown tool ${name}` })
    },
    close: async () => {},
  })
}
