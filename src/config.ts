import { parseArgs } from "node:util";
import { localhostAllowedHostnames } from "@modelcontextprotocol/server";
import type { HttpServerConfig } from "./httpServer.js";
import { formatError } from "./utils.js";

export type ServerTransport = "stdio" | "http";

export interface ServerConfig {
  transport: ServerTransport;
  http: HttpServerConfig;
}

export interface ParseServerConfigOptions {
  env?: NodeJS.ProcessEnv;
  argv?: string[];
}

const DEFAULT_TRANSPORT = "stdio";
const DEFAULT_HTTP_HOST = "127.0.0.1";
const DEFAULT_HTTP_PORT = "3000";
const DEFAULT_HTTP_PATH = "/mcp";
export const LOOPBACK_ALLOWED_HOSTNAMES: readonly string[] = localhostAllowedHostnames();
// Bind addresses use the bare IPv6 form ("::1") while URL hostnames keep brackets ("[::1]").
const LOOPBACK_BIND_HOSTS = new Set(
  LOOPBACK_ALLOWED_HOSTNAMES.map((hostname) => hostname.replace(/^\[(.*)\]$/, "$1"))
);

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function parseServerConfig(options: ParseServerConfigOptions = {}): ServerConfig {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv.slice(2);
  const cli = parseCliArgs(argv);

  const transport = parseTransport(
    cli.transport ?? env.MCP_TRANSPORT ?? DEFAULT_TRANSPORT
  );
  const host = parseHost(cli.host ?? env.MCP_HTTP_HOST ?? DEFAULT_HTTP_HOST);
  const port = parsePort(cli.port ?? env.MCP_HTTP_PORT ?? DEFAULT_HTTP_PORT);
  const httpPath = parseHttpPath(cli.path ?? env.MCP_HTTP_PATH ?? DEFAULT_HTTP_PATH);
  const allowedHosts = resolveAllowedHostnames({
    value: cli["allowed-hosts"] ?? env.MCP_HTTP_ALLOWED_HOSTS,
    host,
    settingName: "MCP_HTTP_ALLOWED_HOSTS",
    cliOption: "--allowed-hosts",
    allowEmpty: false,
    required: transport === "http",
  });
  const allowedOrigins = resolveAllowedHostnames({
    value: cli["allowed-origins"] ?? env.MCP_HTTP_ALLOWED_ORIGINS,
    host,
    settingName: "MCP_HTTP_ALLOWED_ORIGINS",
    cliOption: "--allowed-origins",
    allowEmpty: true,
    required: transport === "http",
  });

  return {
    transport,
    http: {
      host,
      port,
      path: httpPath,
      allowedHosts,
      allowedOrigins,
    },
  };
}

function parseCliArgs(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      options: {
        transport: { type: "string" },
        host: { type: "string" },
        port: { type: "string" },
        path: { type: "string" },
        "allowed-hosts": { type: "string" },
        "allowed-origins": { type: "string" },
      },
      strict: true,
    }).values;
  } catch (error) {
    throw new ConfigError(formatError(error));
  }
}

function parseTransport(value: string): ServerTransport {
  const normalized = value.trim().toLowerCase();

  if (normalized === "stdio") {
    return "stdio";
  }

  if (normalized === "http" || normalized === "streamable-http") {
    return "http";
  }

  throw new ConfigError(
    `Invalid MCP_TRANSPORT value "${value}". Expected "stdio", "http", or "streamable-http".`
  );
}

function parseHost(value: string): string {
  const host = value.trim();
  if (!host) {
    throw new ConfigError("MCP_HTTP_HOST must not be empty.");
  }

  return host;
}

function parsePort(value: string): number {
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    throw new ConfigError(`MCP_HTTP_PORT must be an integer between 1 and 65535. Received "${value}".`);
  }

  const port = Number(trimmed);
  if (port < 1 || port > 65535) {
    throw new ConfigError(`MCP_HTTP_PORT must be between 1 and 65535. Received ${port}.`);
  }

  return port;
}

function parseHttpPath(value: string): string {
  const httpPath = value.trim();

  if (!httpPath.startsWith("/")) {
    throw new ConfigError(`MCP_HTTP_PATH must start with "/". Received "${value}".`);
  }

  if (httpPath.includes("?") || httpPath.includes("#")) {
    throw new ConfigError("MCP_HTTP_PATH must not include query strings or fragments.");
  }

  return httpPath;
}

interface ResolveAllowedHostnamesOptions {
  value: string | undefined;
  host: string;
  settingName: string;
  cliOption: string;
  allowEmpty: boolean;
  required: boolean;
}

function resolveAllowedHostnames(options: ResolveAllowedHostnamesOptions): string[] {
  if (options.value === undefined) {
    if (LOOPBACK_BIND_HOSTS.has(options.host.toLowerCase())) {
      return [...LOOPBACK_ALLOWED_HOSTNAMES];
    }

    if (!options.required) {
      return [];
    }

    throw new ConfigError(
      `${options.settingName} (or ${options.cliOption}) must be set when MCP_HTTP_HOST is "${options.host}".`
    );
  }

  return parseAllowedHostnames(options.value, options.settingName, options.allowEmpty);
}

function parseAllowedHostnames(value: string, settingName: string, allowEmpty: boolean): string[] {
  if (value.trim() === "") {
    if (allowEmpty) {
      return [];
    }

    throw new ConfigError(`${settingName} must contain at least one hostname.`);
  }

  const entries = value.split(",");
  if (entries.some((entry) => entry.trim() === "")) {
    throw new ConfigError(`${settingName} must be a comma-separated list without empty entries.`);
  }

  const normalized = entries.map((entry) => normalizeAllowedHostname(entry.trim(), settingName));
  return [...new Set(normalized)];
}

function normalizeAllowedHostname(value: string, settingName: string): string {
  const hostname = value.toLowerCase();
  if (hostname.includes("*")) {
    throw invalidHostnameError(settingName, value);
  }

  try {
    const parsed = new URL(`http://${hostname}`);
    if (
      parsed.hostname !== hostname
      || parsed.port !== ""
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.pathname !== "/"
      || parsed.search !== ""
      || parsed.hash !== ""
    ) {
      throw invalidHostnameError(settingName, value);
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }

    throw invalidHostnameError(settingName, value);
  }

  return hostname;
}

function invalidHostnameError(settingName: string, value: string): ConfigError {
  return new ConfigError(
    `${settingName} entries must be hostnames without a scheme, port, path, or wildcard. Received "${value}".`
  );
}
