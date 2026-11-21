import type { SsoApi } from './sso'

/** fake mode: an Identity Center that approves at once, with one account and one role */
export const fakeSsoApi = (): SsoApi => ({
  register: async (region) => ({ clientId: 'fake', clientSecret: 'fake', expiresAt: Date.now() + 90 * 86_400_000, region }),
  startDevice: async () => ({ deviceCode: 'fake', userCode: 'ABCD-EFGH', url: 'https://example.awsapps.com/start/#/device', intervalSec: 1, expiresInSec: 60 }),
  createToken: async () => ({ accessToken: 'fake', refreshToken: 'fake', expiresAt: Date.now() + 8 * 3600_000 }),
  listAccounts: async () => [{ id: '123456789012', name: 'Figolu test' }],
  listRoles: async () => ['BedrockUser'],
  roleCredentials: async () => ({ accessKeyId: 'AKIAFAKE', secretAccessKey: 'fake', sessionToken: 'fake', expiration: Date.now() + 3600_000 }),
})
