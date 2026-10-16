import type { VisitorAccessConfig } from "./config.js";
import { isRestrictedVisitorRole, type GatewayRoles } from "./roles.js";

/** What Settings may show. Infrastructure credentials stay in the Gateway config. */
export type VisitorPolicyView = {
  managed: true;
  policyName: string;
  defaultTtlDays: number | null;
  maxVisitors: number;
  roleId: string | null;
  roleBound: boolean;
};

/** The access policy Settings can show. The Cloudflare account, application and token are not included. */
export function describeVisitorPolicy(
  config: VisitorAccessConfig,
  roles: GatewayRoles,
): VisitorPolicyView {
  const name = roles?.default;
  const role =
    name && roles && Object.hasOwn(roles.definitions, name) ? roles.definitions[name] : undefined;
  const roleBound = Boolean(
    role?.sessions && role.scopes && role.agents !== undefined && isRestrictedVisitorRole(role),
  );
  return {
    managed: true,
    policyName: config.policyName,
    defaultTtlDays: config.defaultTtlDays,
    maxVisitors: config.maxVisitors,
    roleId: role && name ? name : null,
    roleBound,
  };
}
