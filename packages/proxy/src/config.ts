import type { AuthContext } from "@athena-shell/shared";

export type AuthProviderKind = "mock" | "alb";

export interface AlbAuthSettings {
  accountId: string;
  namePrefix: string;
  dataBucket: string;
  resultsBucket: string;
  glueDatabase: string;
}

export interface ProxyConfig {
  port: number;
  region: string;
  authProvider: AuthProviderKind;
  /** Populated when authProvider === "alb". */
  alb: AlbAuthSettings | null;
  /** Back-compat: keep the old flag in sync with authProvider === "mock". */
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
    userDatabase: "workspace_dev_user",
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

function parseAuthProvider(env: NodeJS.ProcessEnv): AuthProviderKind {
  const explicit = (env.AUTH_PROVIDER ?? "").toLowerCase();
  if (explicit === "alb") return "alb";
  // Default: mock. Production deploys MUST set AUTH_PROVIDER=alb explicitly
  // (the Fargate task def in infrastructure/terraform/ecs.tf does this).
  // The defense-in-depth against "deployed build is silently mock" is
  // VITE_AUTH_PROVIDER=cognito on the SPA side — a mock-mode proxy cannot
  // validate Cognito bearer tokens, so every /api/* returns 401 rather than
  // silently serving mock data.
  return "mock";
}

function parseAlbSettings(
  authProvider: AuthProviderKind,
  env: NodeJS.ProcessEnv
): AlbAuthSettings | null {
  if (authProvider !== "alb") return null;
  const required = {
    accountId: env.AWS_ACCOUNT_ID,
    namePrefix: env.NAME_PREFIX,
    dataBucket: env.DATA_BUCKET,
    resultsBucket: env.RESULTS_BUCKET,
    glueDatabase: env.GLUE_DATABASE,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(
      `AUTH_PROVIDER=alb requires env vars: ${missing.join(", ")}`
    );
  }
  return {
    accountId: required.accountId!,
    namePrefix: required.namePrefix!,
    dataBucket: required.dataBucket!,
    resultsBucket: required.resultsBucket!,
    glueDatabase: required.glueDatabase!,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  const authProvider = parseAuthProvider(env);
  return {
    port: Number(env.PORT ?? 8080),
    region: env.AWS_REGION ?? "us-east-1",
    authProvider,
    alb: parseAlbSettings(authProvider, env),
    mockAuth: authProvider === "mock",
    staticDir: env.STATIC_DIR ?? null,
    mockUsers: parseMockUsers(env.MOCK_USERS_JSON),
  };
}
