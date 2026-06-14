// lib/secrets.ts
// Secret handling via a Key Vault abstraction.
//
// Provisioning generates a database admin password, but the plaintext is never
// written to the database or the audit log. Instead the password is handed to a
// SecretStore, which returns a *reference* (a vault URI + secret id). Only that
// reference is persisted on the provisioned resource, so a leaked database row or
// timeline entry can never expose the credential.
//
// SimulationSecretStore is the demo-safe implementation: it derives a deterministic
// Azure Key Vault-style URI and a generated secret id without talking to any cloud
// service. In production this seam would be backed by Azure Key Vault using
// @azure/keyvault-secrets + @azure/identity, e.g.:
//
//   import { SecretClient } from "@azure/keyvault-secrets";
//   import { DefaultAzureCredential } from "@azure/identity";
//
//   class AzureKeyVaultSecretStore implements SecretStore {
//     async storeSecret(name: string, value: string): Promise<SecretReference> {
//       const client = new SecretClient(this.vaultUrl, new DefaultAzureCredential());
//       const secret = await client.setSecret(name, value);
//       return { name, uri: secret.properties.vaultUrl + "/secrets/" + name, id: secret.properties.version! };
//     }
//   }
//
// The interface is intentionally narrow so the rest of the app only ever sees
// references, never secret material.

import { randomBytes } from "node:crypto";

export interface SecretReference {
  // Logical name of the secret within the vault.
  name: string;
  // Fully-qualified vault URI that an operator/app would resolve at runtime.
  uri: string;
  // Opaque secret version id (Key Vault returns one per write).
  id: string;
}

export interface SecretStore {
  readonly kind: "simulation" | "azure-key-vault";
  // Stores secret material and returns only a reference to it. Implementations
  // must never persist or log the plaintext value beyond the underlying vault.
  storeSecret(name: string, value: string): Promise<SecretReference>;
}

// Default simulated vault name, mirrors the resource-group naming used elsewhere.
const SIMULATION_VAULT_NAME = process.env.STACKGATE_KEYVAULT_NAME || "kv-stackgate-sim";

class SimulationSecretStore implements SecretStore {
  readonly kind = "simulation" as const;

  async storeSecret(name: string, _value: string): Promise<SecretReference> {
    // The value is intentionally ignored here: a real Key Vault would persist it,
    // but in simulation we only fabricate a reference so the plaintext never leaves
    // memory. The underscore-prefixed param documents that contract.
    const version = randomBytes(16).toString("hex");
    const vaultHost = `https://${SIMULATION_VAULT_NAME}.vault.azure.net`;
    return {
      name,
      uri: `${vaultHost}/secrets/${name}/${version}`,
      id: version,
    };
  }
}

export const simulationSecretStore: SecretStore = new SimulationSecretStore();

// Returns the active secret store. Today this is always the simulation store;
// a production deployment would branch on STACKGATE_PROVISIONING_PROVIDER to
// return an AzureKeyVaultSecretStore (see the comment block above).
export function getSecretStore(): SecretStore {
  return simulationSecretStore;
}

// Builds the conventional secret name for a database admin credential so the
// reference is predictable and human-readable in the vault.
export function adminPasswordSecretName(serverName: string): string {
  return `${serverName}-admin-password`;
}
