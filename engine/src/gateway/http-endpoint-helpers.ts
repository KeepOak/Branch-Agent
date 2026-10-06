// Gateway HTTP endpoint helpers.
// Wraps common POST JSON method, auth, scope, and body handling.
import type { IncomingMessage, ServerResponse } from "node:http";
import { isLockdownOn, LOCKDOWN_MESSAGE } from "../config/lockdown.js";
import {
  readJsonBodyOrError,
  sendJson,
  sendMethodNotAllowed,
  sendMissingScopeForbidden,
} from "./http-common.js";
import type { GatewayHttpRequestAuthOptions } from "./http-request-authority.js";
import {
  authorizeGatewayHttpRequestOrReply,
  type AuthorizedGatewayHttpRequest,
  resolveTrustedHttpOperatorScopes,
} from "./http-utils.js";
import {
  authorizeOperatorScopesForMethod,
  resolveLeastPrivilegeOperatorScopesForMethod,
} from "./method-scopes.js";

function isReadOnlyMethod(method: string): boolean {
  const scopes = resolveLeastPrivilegeOperatorScopesForMethod(method);
  return scopes.length > 0 && scopes.every((scope) => scope === "operator.read");
}

/** Handles a gateway POST JSON endpoint and returns the parsed body when authorized. */
export async function handleGatewayPostJsonEndpoint(
  req: IncomingMessage,
  res: ServerResponse,
  opts: GatewayHttpRequestAuthOptions & {
    pathname: string;
    maxBodyBytes: number;
    requiredOperatorMethod?: "chat.send" | (string & Record<never, never>);
    resolveOperatorScopes?: (
      req: IncomingMessage,
      requestAuth: AuthorizedGatewayHttpRequest,
    ) => string[];
  },
): Promise<
  | false
  | { body: unknown; requestAuth: AuthorizedGatewayHttpRequest; operatorScopes: string[] }
  | undefined
> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== opts.pathname) {
    return false;
  }

  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return undefined;
  }

  const requestAuth = await authorizeGatewayHttpRequestOrReply({
    ...opts,
    req,
    res,
  });
  if (!requestAuth) {
    return undefined;
  }

  const operatorScopes =
    opts.resolveOperatorScopes?.(req, requestAuth) ??
    resolveTrustedHttpOperatorScopes(req, requestAuth);
  if (opts.requiredOperatorMethod) {
    const scopeAuth = authorizeOperatorScopesForMethod(opts.requiredOperatorMethod, operatorScopes);
    if (!scopeAuth.allowed) {
      sendMissingScopeForbidden(res, scopeAuth.missingScope);
      return undefined;
    }
  }
  if (opts.requiredOperatorMethod && isLockdownOn() && !isReadOnlyMethod(opts.requiredOperatorMethod)) {
    // Lockdown: /v1/chat/completions, /v1/responses and /v1/embeddings all spend; refuse before the body is read.
    sendJson(res, 503, { error: { message: LOCKDOWN_MESSAGE, type: "lockdown" } });
    return undefined;
  }

  const body = await readJsonBodyOrError(req, res, opts.maxBodyBytes);
  if (body === undefined) {
    return undefined;
  }
  try {
    await requestAuth.revalidate();
  } catch (error) {
    if (res.writableEnded || res.destroyed) {
      return undefined;
    }
    throw error;
  }

  return { body, requestAuth, operatorScopes };
}
