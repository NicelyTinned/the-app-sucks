import { parse as parseYaml } from "yaml";
import { decryptText } from "./security";

export interface InputProperty {
  type: "string" | "number" | "integer" | "boolean";
  description?: string;
  enum?: Array<string | number | boolean>;
}

export interface PluginTool {
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  input_schema: {
    type: "object";
    properties: Record<string, InputProperty>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface PluginManifest {
  name: string;
  version: number;
  description: string;
  hosts: string[];
  secrets?: string[];
  tools: PluginTool[];
}

interface PluginSecretRow {
  secret_name: string;
  value_cipher: string;
  value_iv: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateHost(host: unknown): string {
  if (typeof host !== "string") return fail("Every item in hosts must be a domain name.");
  const normalized = host.toLowerCase().trim();
  if (
    normalized.length > 253 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized) ||
    /^\d+\.\d+\.\d+\.\d+$/.test(normalized) ||
    ["localhost", "local", "internal", "test", "invalid", "example", "arpa", "lan", "home", "corp", "onion"].some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`))
  ) return fail(`Host "${host}" is not an allowed public DNS name.`);
  return normalized;
}

function validateInputSchema(schema: unknown): PluginTool["input_schema"] {
  if (!isRecord(schema) || schema.type !== "object" || !isRecord(schema.properties)) {
    return fail("Each tool needs input_schema with type: object and a properties map.");
  }
  const properties: Record<string, InputProperty> = {};
  for (const [name, property] of Object.entries(schema.properties)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(name) || !isRecord(property)) {
      return fail(`Invalid tool input property: ${name}`);
    }
    if (!["string", "number", "integer", "boolean"].includes(property.type)) {
      return fail(`Unsupported type for input "${name}". Use string, number, integer, or boolean.`);
    }
    const item: InputProperty = { type: property.type };
    if (typeof property.description === "string") item.description = property.description.slice(0, 250);
    if (Array.isArray(property.enum) && property.enum.length <= 30) item.enum = property.enum;
    properties[name] = item;
  }
  const required = Array.isArray(schema.required) ? schema.required.filter((item: unknown) => typeof item === "string") : [];
  for (const item of required) if (!(item in properties)) return fail(`Required input "${item}" is not in properties.`);
  return { type: "object", properties, required, additionalProperties: false };
}

function checkTemplate(template: string, allowedInputs: Set<string>, allowedSecrets: Set<string>) {
  const tokens = template.match(/\$\{[^}]+\}/g) || [];
  for (const token of tokens) {
    const inputMatch = /^\$\{input\.([a-zA-Z][a-zA-Z0-9_]*)\}$/.exec(token);
    const secretMatch = /^\$\{secret\.([A-Z][A-Z0-9_]*)\}$/.exec(token);
    if (inputMatch && allowedInputs.has(inputMatch[1])) continue;
    if (secretMatch && allowedSecrets.has(secretMatch[1])) continue;
    fail(`Unknown or invalid template token: ${token}`);
  }
}

function validateTool(raw: unknown, hosts: string[], secretNames: string[]): PluginTool {
  if (!isRecord(raw)) return fail("Each tools entry must be an object.");
  const name = String(raw.name || "").trim();
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(name)) return fail(`Tool name "${name}" must be 2–40 lowercase letters, numbers, or underscores.`);
  const description = String(raw.description || "").trim();
  if (!description) return fail(`Tool "${name}" needs a description.`);
  const method = String(raw.method || "GET").toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return fail(`Tool "${name}" uses an unsupported HTTP method.`);
  const input_schema = validateInputSchema(raw.input_schema);
  const allowedInputs = new Set(Object.keys(input_schema.properties));
  const allowedSecrets = new Set(secretNames);
  const urlTemplate = String(raw.url || "").trim();
  if (!urlTemplate || urlTemplate.length > 1600) return fail(`Tool "${name}" needs a URL under 1600 characters.`);
  checkTemplate(urlTemplate, allowedInputs, allowedSecrets);
  const sampleUrl = urlTemplate.replace(/\$\{(?:input|secret)\.[^}]+\}/g, "sample");
  let parsed: URL;
  try { parsed = new URL(sampleUrl); } catch { return fail(`Tool "${name}" has an invalid URL.`); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) {
    return fail(`Tool "${name}" must use HTTPS on the standard port and cannot include URL credentials.`);
  }
  if (!hosts.includes(parsed.hostname.toLowerCase())) return fail(`Tool "${name}" URL host must appear in the hosts allowlist.`);
  if (parsed.hash) return fail(`Tool "${name}" URL cannot contain a fragment.`);

  const headers = isRecord(raw.headers) ? raw.headers : undefined;
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (!/^[a-zA-Z0-9-]{1,60}$/.test(key) || typeof value !== "string" || value.length > 1200) {
        return fail(`Tool "${name}" has an invalid HTTP header.`);
      }
      if (["host", "content-length", "cookie", "set-cookie", "connection", "transfer-encoding"].includes(key.toLowerCase())) {
        return fail(`Tool "${name}" cannot set the ${key} header.`);
      }
      checkTemplate(value, allowedInputs, allowedSecrets);
    }
  }
  if (raw.body !== undefined) {
    const serialized = JSON.stringify(raw.body);
    if (serialized.length > 12_000) return fail(`Tool "${name}" request body is too large.`);
    checkTemplate(serialized, allowedInputs, allowedSecrets);
  }
  return {
    name,
    description: description.slice(0, 400),
    method: method as PluginTool["method"],
    url: urlTemplate,
    ...(headers ? { headers: headers as Record<string, string> } : {}),
    ...(raw.body !== undefined ? { body: raw.body } : {}),
    input_schema
  };
}

export function validatePluginYaml(source: string): PluginManifest {
  if (typeof source !== "string" || source.length > 30_000) return fail("Plugin YAML must be text under 30 KB.");
  let raw: unknown;
  try {
    raw = parseYaml(source, { uniqueKeys: true, maxAliasCount: 0, schema: "core" });
  } catch {
    return fail("The YAML could not be parsed. Check indentation, quotes, and duplicate keys.");
  }
  if (!isRecord(raw)) return fail("A plugin file must start with a YAML object.");
  const name = String(raw.name || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(name)) return fail("Plugin name must be 2–40 lowercase letters, numbers, or hyphens.");
  const version = Number(raw.version || 1);
  if (version !== 1) return fail("Only plugin DSL version 1 is supported.");
  const description = String(raw.description || "").trim();
  if (!description) return fail("Add a short plugin description.");
  if (!Array.isArray(raw.hosts) || raw.hosts.length < 1 || raw.hosts.length > 8) return fail("A plugin must allowlist between 1 and 8 public HTTPS hosts.");
  const hosts = [...new Set(raw.hosts.map(validateHost))];
  const secrets = raw.secrets === undefined ? [] : raw.secrets;
  if (!Array.isArray(secrets) || secrets.length > 12 || secrets.some((name: unknown) => typeof name !== "string" || !/^[A-Z][A-Z0-9_]{1,39}$/.test(name))) {
    return fail("secrets must be a list of up to 12 names such as API_TOKEN.");
  }
  const secretNames = [...new Set(secrets as string[])];
  if (!Array.isArray(raw.tools) || raw.tools.length < 1 || raw.tools.length > 8) return fail("A plugin must define between 1 and 8 tools.");
  const tools = raw.tools.map((tool: unknown) => validateTool(tool, hosts, secretNames));
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) return fail("Tool names must be unique within a plugin.");
  return { name, version, description: description.slice(0, 500), hosts, secrets: secretNames, tools };
}

function validateArgs(tool: PluginTool, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return fail("Tool arguments must be a JSON object.");
  const schema = tool.input_schema;
  const keys = Object.keys(value);
  if (keys.some((key) => !(key in schema.properties))) return fail("The tool arguments contain an unknown field.");
  for (const field of schema.required || []) if (!(field in value)) return fail(`Missing required input: ${field}`);
  for (const [key, item] of Object.entries(value)) {
    const expected = schema.properties[key];
    const valid = expected.type === "string" ? typeof item === "string"
      : expected.type === "boolean" ? typeof item === "boolean"
      : expected.type === "integer" ? typeof item === "number" && Number.isInteger(item)
      : typeof item === "number" && Number.isFinite(item);
    if (!valid) return fail(`Input "${key}" must be ${expected.type}.`);
    if (typeof item === "string" && item.length > 3000) return fail(`Input "${key}" is too long.`);
    if (expected.enum && !expected.enum.includes(item as any)) return fail(`Input "${key}" is not an allowed value.`);
  }
  return value;
}

function renderTemplate(value: unknown, args: Record<string, unknown>, secrets: Record<string, string>): unknown {
  if (typeof value === "string") {
    const exactInput = /^\$\{input\.([a-zA-Z][a-zA-Z0-9_]*)\}$/.exec(value);
    if (exactInput) return args[exactInput[1]];
    const exactSecret = /^\$\{secret\.([A-Z][A-Z0-9_]*)\}$/.exec(value);
    if (exactSecret) return secrets[exactSecret[1]] ?? "";
    return value.replace(/\$\{input\.([a-zA-Z][a-zA-Z0-9_]*)\}|\$\{secret\.([A-Z][A-Z0-9_]*)\}/g, (_match, inputName, secretName) => {
      const replacement = inputName ? args[inputName] : secrets[secretName];
      return encodeURIComponent(String(replacement ?? ""));
    });
  }
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, args, secrets));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderTemplate(item, args, secrets)]));
  }
  return value;
}

interface PluginDbStatement {
  bind(...values: any[]): PluginDbStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
interface PluginDb {
  prepare(query: string): PluginDbStatement;
}
interface PluginExecutionEnv {
  DB: PluginDb;
  KEY_ENCRYPTION_SECRET: string;
}

export async function executePluginTool(
  env: PluginExecutionEnv,
  userId: string,
  pluginId: string,
  manifest: PluginManifest,
  toolName: string,
  rawArgs: unknown
): Promise<{ status: number; data: string }> {
  const tool = manifest.tools.find((item) => item.name === toolName);
  if (!tool) return fail("That tool is not part of the enabled plugin.");
  const args = validateArgs(tool, rawArgs);
  const secretRows = await env.DB.prepare(
    "SELECT secret_name, value_cipher, value_iv FROM plugin_secrets WHERE user_id = ? AND plugin_id = ?"
  ).bind(userId, pluginId).all<PluginSecretRow>();
  const secretValues: Record<string, string> = {};
  for (const row of secretRows.results || []) {
    secretValues[row.secret_name] = await decryptText(env.KEY_ENCRYPTION_SECRET, row.value_cipher, row.value_iv);
  }
  for (const name of manifest.secrets || []) {
    if (!secretValues[name]) return fail(`Set the plugin secret ${name} before running this tool.`);
  }

  const renderedUrl = String(renderTemplate(tool.url, args, secretValues));
  const url = new URL(renderedUrl);
  if (url.protocol !== "https:" || !manifest.hosts.includes(url.hostname.toLowerCase()) || (url.port && url.port !== "443")) {
    return fail("The rendered request URL did not pass the plugin host check.");
  }
  const headers = new Headers({ Accept: "application/json, text/plain;q=0.9, */*;q=0.5" });
  for (const [name, value] of Object.entries(tool.headers || {})) {
    headers.set(name, String(renderTemplate(value, args, secretValues)));
  }
  let body: string | undefined;
  if (tool.body !== undefined) {
    body = JSON.stringify(renderTemplate(tool.body, args, secretValues));
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url.toString(), {
    method: tool.method,
    headers,
    ...(body && tool.method !== "GET" ? { body } : {}),
    redirect: "manual",
    signal: AbortSignal.timeout(15_000)
  });
  const responseText = (await response.text()).slice(0, 12_000);
  return {
    status: response.status,
    data: responseText || (response.status >= 300 && response.status < 400 ? "Redirect blocked by plugin runner." : "(empty response)")
  };
}
