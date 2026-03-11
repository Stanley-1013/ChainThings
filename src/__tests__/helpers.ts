export function createJsonRequest(
  url: string,
  body: Record<string, unknown>,
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function createGetRequest(url: string): Request {
  return new Request(url, { method: "GET" });
}

export function createDeleteRequest(
  url: string,
  body: Record<string, unknown>,
): Request {
  return new Request(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function createFormDataRequest(url: string, file: File): Request {
  const formData = new FormData();
  formData.append("file", file);
  return new Request(url, {
    method: "POST",
    body: formData,
  });
}

export async function getJsonResponse(response: Response) {
  return response.json();
}
