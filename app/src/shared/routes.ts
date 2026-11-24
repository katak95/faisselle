import { isExpertRoute } from './expert/types'

/** The renderer can navigate only within this workspace. */
export const isAppRoute = (route: unknown): route is string => typeof route === 'string' &&
  (['', '/meetings', '/chat', '/trash', '/settings', '/settings/calendar', '/settings/recordings', '/settings/notes-model', '/settings/bedrock', '/settings/m365', '/settings/atlassian'].includes(route) || /^\/(?:note|chat|folder)\/[\w-]+$/.test(route) || isExpertRoute(route))
