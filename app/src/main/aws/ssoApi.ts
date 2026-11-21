import { AuthorizationPendingException, CreateTokenCommand, RegisterClientCommand, SlowDownException, SSOOIDCClient, StartDeviceAuthorizationCommand } from '@aws-sdk/client-sso-oidc'
import { GetRoleCredentialsCommand, ListAccountRolesCommand, ListAccountsCommand, SSOClient } from '@aws-sdk/client-sso'
import { PendingError, SlowDownError, type SsoApi } from './sso'

const SCOPES = ['sso:account:access']
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

/** The AWS SDK behind the sign-in: Identity Center's OIDC service (the token) and its portal (accounts, roles, keys) */
export function awsSsoApi(): SsoApi {
  const oidc = new Map<string, SSOOIDCClient>(), portal = new Map<string, SSOClient>()
  const oidcIn = (r: string) => { let c = oidc.get(r); if (!c) oidc.set(r, (c = new SSOOIDCClient({ region: r }))); return c }
  const portalIn = (r: string) => { let c = portal.get(r); if (!c) portal.set(r, (c = new SSOClient({ region: r }))); return c }

  return {
    async register(region) {
      const r = await oidcIn(region).send(new RegisterClientCommand({ clientName: 'Faisselle', clientType: 'public', scopes: SCOPES, grantTypes: [DEVICE_GRANT, 'refresh_token'] }))
      if (!r.clientId || !r.clientSecret) throw new Error('AWS did not register Faisselle')
      return { clientId: r.clientId, clientSecret: r.clientSecret, expiresAt: (r.clientSecretExpiresAt ?? 0) * 1000, region }
    },
    async startDevice(client, startUrl) {
      const r = await oidcIn(client.region).send(new StartDeviceAuthorizationCommand({ clientId: client.clientId, clientSecret: client.clientSecret, startUrl }))
      if (!r.deviceCode || !r.userCode) throw new Error('AWS did not start the sign-in')
      return { deviceCode: r.deviceCode, userCode: r.userCode, url: r.verificationUriComplete ?? r.verificationUri ?? startUrl, intervalSec: r.interval ?? 5, expiresInSec: r.expiresIn ?? 600 }
    },
    async createToken(client, grant) {
      try {
        const r = await oidcIn(client.region).send(new CreateTokenCommand({ clientId: client.clientId, clientSecret: client.clientSecret,
          ...('deviceCode' in grant ? { grantType: DEVICE_GRANT, deviceCode: grant.deviceCode } : { grantType: 'refresh_token', refreshToken: grant.refreshToken }) }))
        if (!r.accessToken) throw new Error('AWS gave no token')
        return { accessToken: r.accessToken, ...(r.refreshToken ? { refreshToken: r.refreshToken } : {}), expiresAt: Date.now() + (r.expiresIn ?? 3600) * 1000 }
      } catch (e) {
        if (e instanceof AuthorizationPendingException) throw new PendingError(e.message)
        if (e instanceof SlowDownException) throw new SlowDownError(e.message)
        throw e
      }
    },
    async listAccounts(region, accessToken) {
      const out: Array<{ id: string; name: string }> = []
      let nextToken: string | undefined
      do {
        const r = await portalIn(region).send(new ListAccountsCommand({ accessToken, nextToken, maxResults: 100 }))
        for (const a of r.accountList ?? []) if (a.accountId) out.push({ id: a.accountId, name: a.accountName ?? a.accountId })
        nextToken = r.nextToken
      } while (nextToken && out.length < 1000)
      return out.sort((a, b) => a.name.localeCompare(b.name))
    },
    async listRoles(region, accessToken, accountId) {
      const out: string[] = []
      let nextToken: string | undefined
      do {
        const r = await portalIn(region).send(new ListAccountRolesCommand({ accessToken, accountId, nextToken, maxResults: 100 }))
        for (const x of r.roleList ?? []) if (x.roleName) out.push(x.roleName)
        nextToken = r.nextToken
      } while (nextToken && out.length < 500)
      return out.sort()
    },
    async roleCredentials(region, accessToken, accountId, roleName) {
      const r = await portalIn(region).send(new GetRoleCredentialsCommand({ accessToken, accountId, roleName }))
      const c = r.roleCredentials
      if (!c?.accessKeyId || !c.secretAccessKey || !c.sessionToken) throw new Error('AWS gave no keys for this role')
      return { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, sessionToken: c.sessionToken, expiration: c.expiration ?? Date.now() + 3600_000 }
    },
  }
}
