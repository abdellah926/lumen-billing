import type { OAuthProviderId } from "./providers";
import type { ExternalProfile } from "./resolve";

export type IdentityRecord = {
  userId: string;
  provider: OAuthProviderId;
  providerAccountId: string;
  email: string | null;
  name: string | null;
};

export const identityStore = {
  findIdentity(provider: OAuthProviderId, providerAccountId: string): { userId: string } | undefined {
    return undefined;
  },
  findUserByEmail(email: string): { id: string } | undefined {
    return undefined;
  },
};

export async function createOAuthUser(email: string, name: string | null) {
  return { id: `user_${Math.random().toString(36).slice(2)}`, email, name };
}

export function insertIdentity(userId: string, provider: OAuthProviderId, profile: ExternalProfile) {
  void userId;
  void provider;
  void profile;
}
