const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include", // required for the session cookie across domains
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const err = body?.error ?? { code: "UNKNOWN", message: "request failed" };
    throw new ApiError(res.status, err.code, err.message, err.details);
  }

  return body as T;
}

export const api = {
  register: (email: string, password: string) =>
    request<{ user: { id: string; email: string } }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    request<{ user: { id: string; email: string } }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ userId: string }>("/api/auth/me"),

  listKits: () =>
    request<{ kits: { id: string; status: string; role: string | null; company: string | null; createdAt: string }[] }>(
      "/api/kits"
    ),
  createKit: (input: { jd: string; companyUrl: string; days: number }) =>
    request<{ kitId: string; runId: string; reusedExisting: boolean }>("/api/kits", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createKitsBatch: (cases: { jd: string; companyUrl: string; days: number }[]) =>
    request<{ results: { kitId: string; runId: string; reusedExisting: boolean }[] }>("/api/kits/batch", {
      method: "POST",
      body: JSON.stringify({ cases }),
    }),
  getKit: (id: string) =>
    request<{ id: string; status: string; version: number; failureReason: string | null; kit: any }>(
      `/api/kits/${id}`
    ),

  editBrief: (kitId: string, version: number, patch: any) =>
    request(`/api/kits/${kitId}/brief`, {
      method: "PATCH",
      body: JSON.stringify({ ...patch, version }),
    }),
  editQuestion: (kitId: string, questionId: string, version: number, patch: any) =>
    request(`/api/kits/${kitId}/questions/${questionId}`, {
      method: "PATCH",
      body: JSON.stringify({ ...patch, version }),
    }),
  deleteQuestion: (kitId: string, questionId: string, version: number) =>
    request(`/api/kits/${kitId}/questions/${questionId}`, {
      method: "DELETE",
      body: JSON.stringify({ version }),
    }),
  moveQuestion: (kitId: string, questionId: string, version: number, category: string) =>
    request(`/api/kits/${kitId}/questions/${questionId}/category`, {
      method: "PATCH",
      body: JSON.stringify({ category, version }),
    }),
  reorderQuestions: (kitId: string, category: string, version: number, orderedIds: string[]) =>
    request(`/api/kits/${kitId}/categories/${category}/order`, {
      method: "PUT",
      body: JSON.stringify({ orderedIds, version }),
    }),
  addQuestion: (kitId: string, version: number, input: any) =>
    request(`/api/kits/${kitId}/questions`, {
      method: "POST",
      body: JSON.stringify({ ...input, version }),
    }),
  editFlashcard: (kitId: string, flashcardId: string, version: number, patch: any) =>
    request(`/api/kits/${kitId}/flashcards/${flashcardId}`, {
      method: "PATCH",
      body: JSON.stringify({ ...patch, version }),
    }),
  deleteFlashcard: (kitId: string, flashcardId: string, version: number) =>
    request(`/api/kits/${kitId}/flashcards/${flashcardId}`, {
      method: "DELETE",
      body: JSON.stringify({ version }),
    }),
  addFlashcard: (kitId: string, version: number, input: any) =>
    request(`/api/kits/${kitId}/flashcards`, {
      method: "POST",
      body: JSON.stringify({ ...input, version }),
    }),
  regenerateSection: (kitId: string, version: number, input: any) =>
    request(`/api/kits/${kitId}/regenerate`, {
      method: "POST",
      body: JSON.stringify({ ...input, version }),
    }),

  getWeakSpots: (kitId: string) =>
    request<{ weakSpots: { requirementId: string; requirementText: string; priority: string; reason: string; riskScore: number }[] }>(
      `/api/kits/${kitId}/weak-spots`
    ),

  recordPracticeConfidence: (kitId: string, flashcardId: string, confidence: string) =>
    request(`/api/kits/${kitId}/practice/record`, {
      method: "POST",
      body: JSON.stringify({ flashcardId, confidence }),
    }),
  getPracticeSession: (kitId: string) =>
    request<{ orderedFlashcardIds: string[]; progress: Record<string, any>; covered: string[]; totalCount: number }>(
      `/api/kits/${kitId}/practice/session`
    ),
};

export function kitProgressStreamUrl(kitId: string, runId: string): string {
  return `${API_BASE}/api/kits/${kitId}/runs/${runId}/stream`;
}
