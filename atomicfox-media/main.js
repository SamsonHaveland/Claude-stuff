// Inbox for inquiries.
const CONTACT_EMAIL = "Samson@filmlv.com";

// Videos for the Work section, in display order. Paste YouTube or Vimeo links, or a direct .mp4 URL.
// The section stays hidden while this list is empty.
const VIDEOS = [
  // { title: "Project name", client: "Client / format", url: "https://vimeo.com/123456789" },
];

document.getElementById("year").textContent = new Date().getFullYear();

document.querySelectorAll("[data-email]").forEach((a) => {
  a.href = `mailto:${CONTACT_EMAIL}`;
  a.textContent = CONTACT_EMAIL;
});

// Mobile menu
const nav = document.querySelector(".nav");
const toggle = document.querySelector(".nav__toggle");
toggle.addEventListener("click", () => {
  const open = nav.classList.toggle("is-open");
  toggle.setAttribute("aria-expanded", open);
  toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
});
document.querySelectorAll("#menu a").forEach((a) =>
  a.addEventListener("click", () => {
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  })
);

// Contact form: no backend, so open the visitor's mail client with the inquiry filled in.
const form = document.getElementById("contact-form");
const note = form.querySelector(".form__note");
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(form));
  if (!d.name.trim() || !form.email.checkValidity() || !d.email.trim()) {
    note.textContent = "Please add your name and a valid email.";
    return;
  }
  const subject = `Production inquiry: ${d.type}${d.company ? ` / ${d.company}` : ""}`;
  const body = [
    `Name: ${d.name}`,
    `Company: ${d.company || "-"}`,
    `Email: ${d.email}`,
    `Phone: ${d.phone || "-"}`,
    `Project type: ${d.type}`,
    `Shoot dates: ${d.dates || "-"}`,
    "",
    d.details,
  ].join("\n");
  window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  note.textContent = "Opening your email app. If nothing happens, email us at " + CONTACT_EMAIL + ".";
});

// Work section
function embedFor(url) {
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  if (yt) return { type: "iframe", src: `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0` };
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/(\w+))?/);
  if (vm) return { type: "iframe", src: `https://player.vimeo.com/video/${vm[1]}${vm[2] ? `?h=${vm[2]}` : ""}` };
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return { type: "video", src: url };
  return null;
}

if (VIDEOS.length) {
  const grid = document.getElementById("reel-grid");
  for (const v of VIDEOS) {
    const e = embedFor(v.url);
    if (!e) continue;
    const item = document.createElement("article");
    item.className = "reel__item";
    const frame = document.createElement("div");
    frame.className = "reel__frame";
    const media = document.createElement(e.type);
    media.src = e.src;
    if (e.type === "iframe") {
      media.title = v.title || "Video";
      media.loading = "lazy";
      media.allow = "autoplay; fullscreen; picture-in-picture";
      media.allowFullscreen = true;
    } else {
      media.controls = true;
      media.preload = "metadata";
      media.playsInline = true;
    }
    frame.append(media);
    item.append(frame);
    for (const [tag, text] of [["h3", v.title], ["p", v.client]]) {
      if (!text) continue;
      const el = document.createElement(tag);
      el.textContent = text;
      item.append(el);
    }
    grid.append(item);
  }
  if (grid.children.length) {
    document.getElementById("reel").hidden = false;
    document.querySelectorAll("[data-reel-link]").forEach((a) => (a.hidden = false));
  }
}
