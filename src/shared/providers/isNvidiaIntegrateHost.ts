import { parseProviderHostname } from './providerHostname.js';

/** True when the provider base URL targets NVIDIA build.nvidia.com NIM Integrate. */
export function isNvidiaIntegrateHost(baseUrl: string): boolean {
  return parseProviderHostname(baseUrl).nvidia;
}
