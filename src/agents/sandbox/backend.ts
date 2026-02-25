/**
 * Sandbox backend abstraction.
 *
 * Provides a unified interface for switching between Docker and bubblewrap backends.
 */

import { isBwrapAvailable } from "./bwrap.js";
import { execDocker } from "./docker.js";

/**
 * Available sandbox backends.
 */
export type SandboxBackend = "docker" | "bwrap" | "auto";

/**
 * Result of backend detection.
 */
export type BackendDetectionResult = {
  backend: "docker" | "bwrap";
  reason: string;
};

/**
 * Cached detection result.
 */
let cachedBackend: BackendDetectionResult | null = null;

/**
 * Checks if Docker is available on the system.
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    const result = await execDocker(["version"], { allowFailure: true });
    return result.code === 0;
  } catch {
    return false;
  }
}

/**
 * Detects the available sandbox backend.
 * Returns "bwrap" if available (preferred), otherwise "docker" if available, otherwise null.
 */
export async function detectAvailableBackend(): Promise<BackendDetectionResult | null> {
  // Return cached result if available
  if (cachedBackend) {
    return cachedBackend;
  }

  // Try bwrap first (lightweight, no daemon required, preferred for multi-tenancy)
  const bwrapAvailable = await isBwrapAvailable();
  if (bwrapAvailable) {
    cachedBackend = { backend: "bwrap", reason: "bubblewrap is available (preferred)" };
    return cachedBackend;
  }

  // Fall back to Docker
  const dockerAvailable = await isDockerAvailable();
  if (dockerAvailable) {
    cachedBackend = { backend: "docker", reason: "Docker daemon is available (bwrap not found)" };
    return cachedBackend;
  }

  // Neither available
  return null;
}

/**
 * Resolves the sandbox backend to use based on configuration.
 *
 * @param preference - The preferred backend ("docker", "bwrap", or "auto")
 * @returns The resolved backend, or throws if none available
 */
export async function resolveBackend(
  preference: SandboxBackend = "auto",
): Promise<"docker" | "bwrap"> {
  // Explicit preferences
  if (preference === "docker") {
    const available = await isDockerAvailable();
    if (!available) {
      throw new Error(
        "Docker is not available. Please install Docker or use a different sandbox backend.",
      );
    }
    return "docker";
  }

  if (preference === "bwrap") {
    const available = await isBwrapAvailable();
    if (!available) {
      throw new Error(
        "bubblewrap (bwrap) is not available. Please install it or use a different sandbox backend.\n" +
          "On Debian/Ubuntu: apt install bubblewrap\n" +
          "On Fedora: dnf install bubblewrap\n" +
          "On Arch: pacman -S bubblewrap",
      );
    }
    return "bwrap";
  }

  // Auto-detect
  const detected = await detectAvailableBackend();
  if (!detected) {
    throw new Error(
      "No sandbox backend available. Please install Docker or bubblewrap.\n" +
        "Docker: https://docs.docker.com/get-docker/\n" +
        "bubblewrap (bwrap):\n" +
        "  - Debian/Ubuntu: apt install bubblewrap\n" +
        "  - Fedora: dnf install bubblewrap\n" +
        "  - Arch: pacman -S bubblewrap",
    );
  }

  return detected.backend;
}

/**
 * Clears the cached backend detection result.
 * Useful for testing or after system changes.
 */
export function clearBackendCache(): void {
  cachedBackend = null;
}

/**
 * Gets information about available backends.
 */
export async function getBackendInfo(): Promise<{
  docker: { available: boolean };
  bwrap: { available: boolean };
  preferred: "docker" | "bwrap" | null;
  reason: string;
}> {
  const dockerAvailable = await isDockerAvailable();
  const bwrapAvailable = await isBwrapAvailable();

  let preferred: "docker" | "bwrap" | null = null;
  let reason = "No sandbox backend available";

  // Prefer bwrap (lightweight, no daemon required)
  if (bwrapAvailable) {
    preferred = "bwrap";
    reason = "bubblewrap is available (preferred for multi-tenancy)";
  } else if (dockerAvailable) {
    preferred = "docker";
    reason = "Docker is available (bwrap not found)";
  }

  return {
    docker: { available: dockerAvailable },
    bwrap: { available: bwrapAvailable },
    preferred,
    reason,
  };
}

/**
 * Feature comparison between backends.
 */
export const BACKEND_FEATURES = {
  docker: {
    name: "Docker",
    networkIsolation: true,
    userNamespaces: true,
    cgroupLimits: true,
    seccompProfiles: true,
    apparmorProfiles: true,
    imageManagement: true,
    requiresDaemon: true,
    rootRequired: false, // With rootless Docker
  },
  bwrap: {
    name: "bubblewrap",
    networkIsolation: true,
    userNamespaces: true,
    cgroupLimits: false, // Requires additional setup
    seccompProfiles: false, // Not built-in
    apparmorProfiles: false, // Not built-in
    imageManagement: false,
    requiresDaemon: false,
    rootRequired: false,
  },
} as const;
