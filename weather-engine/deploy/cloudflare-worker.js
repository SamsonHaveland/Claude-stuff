// Cloudflare Worker: serves weatherengine.org by forwarding every request to the
// Weather Engine on Google Cloud Run. Cloudflare provides the domain and HTTPS;
// the app (and its password) stay on Cloud Run.
//
// Setup: deploy/CLOUDFLARE.md. Set the ORIGIN variable in the Worker's
// Settings to your Cloud Run address, e.g. https://weather-engine-123456.us-central1.run.app

export default {
  async fetch(request, env) {
    const origin = (env.ORIGIN || "").replace(/\/+$/, "");
    if (!origin.startsWith("https://")) {
      return new Response("Weather Engine: set the ORIGIN variable in the Worker settings.", { status: 500 });
    }

    const url = new URL(request.url);
    if (url.protocol === "http:") {  // always use the secure address
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }

    // Same path, query, method, headers (incl. the login cookie) and body; only the host changes.
    const target = new URL(url.pathname + url.search, origin);
    const forwarded = new Request(target, request);
    return fetch(forwarded, { redirect: "manual" });
  },
};
