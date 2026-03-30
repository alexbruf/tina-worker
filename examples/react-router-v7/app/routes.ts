import { type RouteConfig, index, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('/api/tina/*', 'routes/api.tina.$.tsx'),
] satisfies RouteConfig
