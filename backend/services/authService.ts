import * as SecureStore from 'expo-secure-store';

interface LoginCredentials {
  email: string;
  password: string;
}

interface AuthResponse {
  token: string;
  refreshToken?: string;
  user: Record<string, unknown>;
}

const TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

class AuthService {
  async login(
    credentials: LoginCredentials,
    apiClient: { post: (url: string, data: unknown) => Promise<{ data: AuthResponse }> },
  ): Promise<AuthResponse> {
    const response = await apiClient.post('/auth/login', credentials);
    const { token, refreshToken, user } = response.data;

    await this.storeToken(token);
    if (refreshToken) {
      await this.storeRefreshToken(refreshToken);
    }

    return { token, refreshToken, user };
  }

  async logout(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  }

  async storeToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  }

  async getToken(): Promise<string | null> {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  }

  async storeRefreshToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
  }

  async getRefreshToken(): Promise<string | null> {
    return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  }

  validateToken(token: string): boolean {
    if (!token) return false;

    try {
      const payload = this.decodeToken(token);
      const now = Math.floor(Date.now() / 1000);
      return payload.exp > now;
    } catch {
      return false;
    }
  }

  private decodeToken(token: string): { exp: number } {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token');

    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  }

  async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    return token ? this.validateToken(token) : false;
  }
}

export default new AuthService();
