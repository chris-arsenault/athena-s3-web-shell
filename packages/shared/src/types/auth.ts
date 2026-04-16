export interface AwsTempCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
}

export interface S3WorkspaceScope {
  bucket: string;
  prefix: string;
}

export interface AthenaScope {
  workgroup: string;
  outputLocation: string;
  defaultDatabase?: string;
}

export interface AuthContext {
  userId: string;
  displayName: string;
  email: string;
  region: string;
  roleArn: string;
  s3: S3WorkspaceScope;
  athena: AthenaScope;
}
