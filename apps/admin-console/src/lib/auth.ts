// Lưu JWT trong localStorage. Đăng nhập thật thay cho việc nhúng API key vào SPA.
const TOKEN_KEY = "occ_token";
const ROLE_KEY = "occ_role";
const NAME_KEY = "occ_name";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSession(token: string, role: string, name: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ROLE_KEY, role);
  localStorage.setItem(NAME_KEY, name);
}

export function getRole(): string | null {
  return localStorage.getItem(ROLE_KEY);
}
export function getName(): string | null {
  return localStorage.getItem(NAME_KEY);
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(NAME_KEY);
}
