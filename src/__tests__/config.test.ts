import { ConfigError, LOOPBACK_ALLOWED_HOSTNAMES, parseServerConfig } from "../config.js";

const LOOPBACK_HOSTNAMES = [...LOOPBACK_ALLOWED_HOSTNAMES];

describe("parseServerConfig", () => {
  it("uses stdio and localhost HTTP defaults", () => {
    expect(parseServerConfig({ env: {}, argv: [] })).toEqual({
      transport: "stdio",
      http: {
        host: "127.0.0.1",
        port: 3000,
        path: "/mcp",
        allowedHosts: LOOPBACK_HOSTNAMES,
        allowedOrigins: LOOPBACK_HOSTNAMES,
      },
    });
  });

  it("reads HTTP transport settings from environment variables", () => {
    expect(parseServerConfig({
      env: {
        MCP_TRANSPORT: "streamable-http",
        MCP_HTTP_HOST: "localhost",
        MCP_HTTP_PORT: "3333",
        MCP_HTTP_PATH: "/redash-mcp",
      },
      argv: [],
    })).toEqual({
      transport: "http",
      http: {
        host: "localhost",
        port: 3333,
        path: "/redash-mcp",
        allowedHosts: LOOPBACK_HOSTNAMES,
        allowedOrigins: LOOPBACK_HOSTNAMES,
      },
    });
  });

  it("lets CLI arguments override environment variables", () => {
    expect(parseServerConfig({
      env: {
        MCP_TRANSPORT: "stdio",
        MCP_HTTP_HOST: "127.0.0.1",
        MCP_HTTP_PORT: "3000",
        MCP_HTTP_PATH: "/mcp",
        MCP_HTTP_ALLOWED_HOSTS: "env.example.com",
        MCP_HTTP_ALLOWED_ORIGINS: "env-app.example.com",
      },
      argv: [
        "--transport",
        "http",
        "--host=localhost",
        "--port",
        "4444",
        "--path=/custom",
        "--allowed-hosts=MCP.EXAMPLE.COM,mcp.example.com",
        "--allowed-origins",
        "APP.EXAMPLE.COM,admin.example.com",
      ],
    })).toEqual({
      transport: "http",
      http: {
        host: "localhost",
        port: 4444,
        path: "/custom",
        allowedHosts: ["mcp.example.com"],
        allowedOrigins: ["app.example.com", "admin.example.com"],
      },
    });
  });

  it("rejects options placed after the CLI option terminator", () => {
    expect(() => parseServerConfig({
      env: {},
      argv: ["--", "--transport", "http"],
    })).toThrow(ConfigError);
  });

  it("rejects invalid transports", () => {
    expect(() => parseServerConfig({
      env: { MCP_TRANSPORT: "sse" },
      argv: [],
    })).toThrow(ConfigError);
  });

  it.each(["0", "65536", "-1", "abc", "3000.5"])("rejects invalid ports: %s", (port) => {
    expect(() => parseServerConfig({
      env: { MCP_HTTP_PORT: port },
      argv: [],
    })).toThrow(ConfigError);
  });

  it.each(["mcp", "", "/mcp?x=1", "/mcp#section"])("rejects invalid HTTP paths: %s", (httpPath) => {
    expect(() => parseServerConfig({
      env: { MCP_HTTP_PATH: httpPath },
      argv: [],
    })).toThrow(ConfigError);
  });

  it("requires explicit allowlists for non-loopback HTTP hosts", () => {
    expect(() => parseServerConfig({
      env: {
        MCP_TRANSPORT: "http",
        MCP_HTTP_HOST: "0.0.0.0",
      },
      argv: [],
    })).toThrow("MCP_HTTP_ALLOWED_HOSTS");

    expect(() => parseServerConfig({
      env: {
        MCP_TRANSPORT: "http",
        MCP_HTTP_HOST: "0.0.0.0",
        MCP_HTTP_ALLOWED_HOSTS: "mcp.example.com",
      },
      argv: [],
    })).toThrow("MCP_HTTP_ALLOWED_ORIGINS");
  });

  it("does not require HTTP allowlists for stdio transport", () => {
    expect(parseServerConfig({
      env: {
        MCP_TRANSPORT: "stdio",
        MCP_HTTP_HOST: "0.0.0.0",
      },
      argv: [],
    }).http).toEqual({
      host: "0.0.0.0",
      port: 3000,
      path: "/mcp",
      allowedHosts: [],
      allowedOrigins: [],
    });
  });

  it("allows an explicit empty Origin allowlist to reject all browser origins", () => {
    expect(parseServerConfig({
      env: {
        MCP_TRANSPORT: "http",
        MCP_HTTP_HOST: "0.0.0.0",
        MCP_HTTP_ALLOWED_HOSTS: "localhost,127.0.0.1",
        MCP_HTTP_ALLOWED_ORIGINS: "",
      },
      argv: [],
    }).http).toEqual({
      host: "0.0.0.0",
      port: 3000,
      path: "/mcp",
      allowedHosts: ["localhost", "127.0.0.1"],
      allowedOrigins: [],
    });
  });

  it("accepts bracketed IPv6 loopback hostnames in explicit allowlists", () => {
    expect(parseServerConfig({
      env: {
        MCP_TRANSPORT: "http",
        MCP_HTTP_HOST: "0.0.0.0",
        MCP_HTTP_ALLOWED_HOSTS: "localhost,[::1]",
        MCP_HTTP_ALLOWED_ORIGINS: "localhost,[::1]",
      },
      argv: [],
    }).http).toMatchObject({
      allowedHosts: ["localhost", "[::1]"],
      allowedOrigins: ["localhost", "[::1]"],
    });
  });

  it.each([
    "https://mcp.example.com",
    "mcp.example.com:443",
    "mcp.example.com/path",
    "*.example.com",
    "mcp.example.com,,admin.example.com",
    "::1",
  ])("rejects invalid allowed hostnames: %s", (allowedHostname) => {
    expect(() => parseServerConfig({
      env: { MCP_HTTP_ALLOWED_HOSTS: allowedHostname },
      argv: [],
    })).toThrow(ConfigError);
  });
});
