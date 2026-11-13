import type { ProviderId } from "./providers";

export interface AppSettings {
  personality: string;
  sharedMemory: string;
  memoryEnabled: boolean;
  temperature: number;
  topP: number;
  maxTokens: number;
  defaultProvider: ProviderId;
  defaultModel: string;
}

export interface Chat {
  id: string;
  title: string;
  provider: ProviderId;
  model: string;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id?: number | string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt?: number;
}

export interface ApiKeyMeta {
  id: string;
  provider: ProviderId;
  model: string;
  label: string;
  lastFour: string;
  createdAt: number;
}

export interface PluginMeta {
  id: string;
  name: string;
  description: string;
  yamlSource: string;
  enabled: number | boolean;
  createdAt: number;
}

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  family: string;
}

export interface WorkspaceFile {
  id: string;
  path: string;
  content: string;
  updatedAt: number;
}
