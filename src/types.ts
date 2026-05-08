export interface KankaListResponse<T> {
  data: T[];
  links?: {
    first: string | null;
    last: string | null;
    prev: string | null;
    next: string | null;
  };
  meta?: {
    current_page: number;
    from: number | null;
    last_page: number;
    path: string;
    per_page: number;
    to: number | null;
    total: number;
  };
  sync?: string;
}

export interface KankaSingleResponse<T> {
  data: T;
}

export interface AuthStatus {
  authenticated: boolean;
  source: "env" | "file" | "oauth" | "none";
  expiresAt?: string;
}
