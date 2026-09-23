import { VercelProvider } from "./providers/vercel-provider";
import type { SandboxProvider } from "./types";
import { pilotState } from "@/lib/aidaos/pilot-context";

/** Request-scoped providers reconstructed from an authenticated, signed session. */
export class SandboxManager {
  async getOrCreateProvider(id: string): Promise<SandboxProvider> {
    const existing = this.getProvider(id);
    if (existing) return existing;
    const provider = new VercelProvider({});
    await provider.reconnect(id);
    pilotState().activeSandboxProvider = provider;
    return provider;
  }
  registerSandbox(id: string, provider: SandboxProvider): void {
    const state = pilotState();
    if (
      provider.getSandboxInfo()?.sandboxId !== id ||
      provider.getSandboxInfo()?.provider !== "vercel"
    )
      throw new Error("Invalid sandbox registration");
    state.activeSandboxProvider = provider;
    state.session = {
      owner: state.owner,
      sandboxId: id,
      expiresAt: Date.now() + 1800_000,
    };
  }
  getActiveProvider(): SandboxProvider | null {
    return pilotState().activeSandboxProvider;
  }
  getProvider(id: string): SandboxProvider | null {
    const state = pilotState();
    if (state.session?.sandboxId !== id)
      throw new Error("Sandbox is not owned by this operator session");
    return state.activeSandboxProvider;
  }
  setActiveSandbox(id: string): boolean {
    return !!this.getProvider(id);
  }
  async terminateSandbox(id: string): Promise<void> {
    await this.getProvider(id)?.terminate();
    pilotState().activeSandboxProvider = null;
    pilotState().session = null;
  }
  async terminateAll(): Promise<void> {
    const state = pilotState();
    if (state.session && state.activeSandboxProvider)
      await this.terminateSandbox(state.session.sandboxId);
  }
  async cleanup(): Promise<void> {
    /* Provider TTL owns cleanup. */
  }
}
export const sandboxManager = new SandboxManager();
