const consentUrl = "https://kerryhatcher.github.io/EasyCRM/consent.html";

export function handle(request: Request): Response {
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET" },
    });
  }
  const destination = new URL(consentUrl);
  destination.search = new URL(request.url).search;
  return Response.redirect(destination, 302);
}

if (import.meta.main) Deno.serve(handle);
