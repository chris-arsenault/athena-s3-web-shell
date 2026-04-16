import type { AuthContext } from "@athena-shell/shared";

export interface ProxyConfig {
  port: number;
  region: string;
  mockAuth: boolean;
  staticDir: string | null;
  mockUsers: Record<string, AuthContext>;
}

const DEFAULT_MOCK_USER: AuthContext = {
  userId: "dev-user",
  displayName: "Dev User",
  email: "dev@example.com",
  region: "us-east-1",
  roleArn: "arn:aws:iam::000000000000:role/dev-role",
  s3: { bucket: "athena-shell-dev", prefix: "users/dev/" },
  athena: {
    workgroup: "primary",
    outputLocation: "s3://athena-shell-dev/_athena/dev/",
    defaultDatabase: "default",
  },
};

function parseMockUsers(raw: string | undefined): Record<string, AuthContext> {
  if (!raw) return { [DEFAULT_MOCK_USER.userId]: DEFAULT_MOCK_USER };
  try {
    const parsed = JSON.parse(raw) as Record<string, AuthContext>;
    if (Object.keys(parsed).length === 0) {
      return { [DEFAULT_MOCK_USER.userId]: DEFAULT_MOCK_USER };
    }
    return parsed;
  } catch (err) {
    throw new Error(`MOCK_USERS_JSON is not valid JSON: ${(err as Error).message}`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  return {
    port: Number(env.PORT ?? 8080),
    region: env.AWS_REGION ?? "us-east-1",
    mockAuth: env.MOCK_AUTH === "1" || env.MOCK_AUTH === "true",
    staticDir: env.STATIC_DIR ?? null,
    mockUsers: parseMockUsers(env.MOCK_USERS_JSON),
  };
}
