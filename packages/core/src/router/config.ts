export * as RouterConfig from "./config"

import { ConfigRouter } from "../config/router"

export { ConfigRouter as Schema }

export function resolve(config: ConfigRouter.Info | undefined): ConfigRouter.Info {
  return ConfigRouter.resolve(config)
}
