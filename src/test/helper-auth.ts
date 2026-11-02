// Helpers that tests spawn get a fixed token so direct HTTP calls can authenticate.
export const TEST_HELPER_TOKEN = 'chippy-test-token';

export function testHelperEnv(): NodeJS.ProcessEnv {
  return { ...process.env, CHIPPY_HELPER_TOKEN: TEST_HELPER_TOKEN };
}

export function withHelperToken(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers as Record<string, string>), 'X-Chippy-Token': TEST_HELPER_TOKEN } };
}
