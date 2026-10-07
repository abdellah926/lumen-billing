export type User = {
  id: string;
  email: string;
  name: string;
  is_admin?: boolean;
};

export async function currentUser(): Promise<User | null> {
  return null;
}

export async function createSession(userId: string): Promise<void> {
  void userId;
}

export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}
