export type ProgressFn = (step: string, info: Record<string, any>) => void;

export interface CreateAccountOptions {
  onProgress?: ProgressFn;
  headless?: boolean;
  codexOAuthUrl?: string | null;
  keepOpen?: boolean;
  screenshotDir?: string | null;
}

export interface CreateAccountResult {
  email: string;
  session: any;
  codexCallbackUrl: string | null;
  finalUrl: string;
}

export function createAccount(options?: CreateAccountOptions): Promise<CreateAccountResult>;
