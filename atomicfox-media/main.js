// Inbox for inquiries. TODO: confirm the address before launch.
const CONTACT_EMAIL = "hello@atomicfox.media";

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
